import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import http from "http";
import { Server } from "socket.io";
import { StreamItem, Room, Message, User } from "./src/types";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: true, limit: "15mb" }));

  // In-Memory Database State
  const streams = new Map<string, StreamItem>();
  const rooms = new Map<string, Room>();
  const chatStreams = new Map<string, { messages: Message[] }>();
  const sessions = new Map<string, { username: string }>();

  // Prepopulate default high-quality stable test streams
  const defaultStreams: StreamItem[] = [
    {
      id: "s_tears",
      name: "Tears of Steel (Sci-Fi HLS)",
      url: "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
      logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Tears_of_Steel_1080p_active_poster.jpg/800px-Tears_of_Steel_1080p_active_poster.jpg",
      category: "Movies",
      sourceType: "direct",
      featured: true,
      status: "online",
      createdAt: Date.now()
    },
    {
      id: "s_bbb",
      name: "Big Buck Bunny (Classic Animated HLS)",
      url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
      logo: "https://upload.wikimedia.org/wikipedia/commons/c/c5/Big_Buck_Bunny_堅強的兔子.jpg",
      category: "Cartoons",
      sourceType: "direct",
      featured: true,
      status: "online",
      createdAt: Date.now()
    },
    {
      id: "s_sintel",
      name: "Sintel (Fantasy Drama HLS)",
      url: "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8",
      logo: "https://upload.wikimedia.org/wikipedia/commons/3/36/Sintel_poster.jpg",
      category: "Movies",
      sourceType: "direct",
      featured: false,
      status: "online",
      createdAt: Date.now()
    },
    {
      id: "s_test_stream",
      name: "CPH Akamai HLS Live Test",
      url: "https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8",
      logo: "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=120&auto=format&fit=crop&q=80",
      category: "Test Streams",
      sourceType: "direct",
      featured: false,
      status: "online",
      createdAt: Date.now()
    }
  ];

  defaultStreams.forEach(stream => {
    streams.set(stream.id, stream);
  });

  // Create HTTP Server & Socket.IO instance
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Function to broadcast public rooms update
  function broadcastPublicRooms() {
    const publicList = Array.from(rooms.values())
      .filter(r => r.public)
      .map(r => ({
        id: r.id,
        name: r.name,
        userCount: r.users.length,
        mediaUrl: r.mediaUrl,
        mediaName: r.mediaName,
        isPlaying: r.isPlaying,
        syncEnabled: r.syncEnabled
      }));
    io.emit("public_rooms_update", publicList);
  }

  // Handle Room Disconnection / Leaving helpers
  function handleLeaveRoom(socket: any, roomId: string) {
    const room = rooms.get(roomId);
    if (!room) return;

    const leavingUser = room.users.find(u => u.socketId === socket.id);
    if (!leavingUser) return;

    room.users = room.users.filter(u => u.socketId !== socket.id);
    socket.leave(roomId);
    
    io.to(roomId).emit("user_left", { socketId: socket.id, username: leavingUser.username });

    // If room is empty, do not delete immediately to avoid React 18 strict double-mount destruction.
    // Instead, mark room activity and let the sweeper recycle empty lobbies with a brief grace period.
    if (room.users.length === 0) {
      room.lastActivity = Date.now();
    } else if (room.hostId === socket.id) {
      // Re-appoint host
      const newHost = room.users[0];
      room.hostId = newHost.socketId;
      newHost.isHost = true;
      io.to(roomId).emit("new_host", { socketId: newHost.socketId, username: newHost.username });
    }

    broadcastPublicRooms();
  }

  // ------------------------------------------------------------
  // API Routes
  // ------------------------------------------------------------

  // Fetch all streams
  app.get("/api/streams", (req, res) => {
    res.json(Array.from(streams.values()));
  });

  // Add individual stream
  app.post("/api/streams", (req, res) => {
    const { name, url, logo, category, sourceType, featured } = req.body;
    if (!name || !url) {
      return res.status(400).json({ error: "Name and URL are required" });
    }
    const id = "s_" + Math.random().toString(36).substr(2, 9);
    const newStream: StreamItem = {
      id,
      name,
      url,
      logo: logo || "",
      category: category || "Uncategorized",
      sourceType: sourceType || "direct",
      featured: !!featured,
      status: "online",
      createdAt: Date.now()
    };
    streams.set(id, newStream);
    io.emit("streams_list", Array.from(streams.values()));
    res.json({ success: true, stream: newStream });
  });

  // Edit individual stream
  app.put("/api/streams/:id", (req, res) => {
    const { id } = req.params;
    const stream = streams.get(id);
    if (!stream) {
      return res.status(404).json({ error: "Stream not found" });
    }
    const { name, url, logo, category, featured, status } = req.body;
    if (name) stream.name = name;
    if (url) stream.url = url;
    if (logo !== undefined) stream.logo = logo;
    if (category) stream.category = category;
    if (featured !== undefined) stream.featured = !!featured;
    if (status !== undefined) stream.status = status;

    streams.set(id, stream);
    io.emit("streams_list", Array.from(streams.values()));
    res.json({ success: true, stream });
  });

  // Delete stream
  app.delete("/api/streams/:id", (req, res) => {
    const { id } = req.params;
    if (!streams.has(id)) {
      return res.status(404).json({ error: "Stream not found" });
    }
    streams.delete(id);
    io.emit("streams_list", Array.from(streams.values()));
    res.json({ success: true });
  });

  // Admin APIs for bulk operations, clearing lists, and room moderation
  app.post("/api/admin/streams/delete-multiple", (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: "ids must be an array" });
    }
    let count = 0;
    ids.forEach(id => {
      if (streams.has(id)) {
        streams.delete(id);
        count++;
      }
    });
    io.emit("streams_list", Array.from(streams.values()));
    res.json({ success: true, count });
  });

  app.post("/api/admin/streams/clear", (req, res) => {
    streams.clear();
    io.emit("streams_list", Array.from(streams.values()));
    res.json({ success: true });
  });

  app.post("/api/admin/streams/clean-offline", (req, res) => {
    let count = 0;
    for (const [id, s] of streams.entries()) {
      if (s.status === "offline") {
        streams.delete(id);
        count++;
      }
    }
    io.emit("streams_list", Array.from(streams.values()));
    res.json({ success: true, count });
  });

  // Admin category management APIs
  app.post("/api/admin/categories/rename", (req, res) => {
    const { oldName, newName } = req.body;
    if (!oldName || !newName) {
      return res.status(400).json({ error: "Missing category names" });
    }
    let count = 0;
    for (const [id, s] of streams.entries()) {
      if (s.category === oldName) {
        s.category = newName;
        streams.set(id, s);
        count++;
      }
    }
    io.emit("streams_list", Array.from(streams.values()));
    res.json({ success: true, count });
  });

  app.post("/api/admin/categories/delete", (req, res) => {
    const { categoryName } = req.body;
    if (!categoryName) {
      return res.status(400).json({ error: "Missing category name" });
    }
    let count = 0;
    for (const [id, s] of streams.entries()) {
      if (s.category === categoryName) {
        s.category = "Uncategorized";
        streams.set(id, s);
        count++;
      }
    }
    io.emit("streams_list", Array.from(streams.values()));
    res.json({ success: true, count });
  });

  app.get("/api/admin/rooms", (req, res) => {
    res.json(Array.from(rooms.values()));
  });

  app.delete("/api/admin/rooms/:id", (req, res) => {
    const { id } = req.params;
    if (rooms.has(id)) {
      io.to(id).emit("room_deleted", id);
      rooms.delete(id);
      broadcastPublicRooms();
      return res.json({ success: true });
    }
    res.status(404).json({ error: "Room not found" });
  });

  // Export public watch party rooms list
  app.get("/api/public-rooms", (req, res) => {
    const publicList = Array.from(rooms.values())
      .filter(r => r.public)
      .map(r => ({
        id: r.id,
        name: r.name,
        userCount: r.users.length,
        mediaUrl: r.mediaUrl,
        mediaName: r.mediaName,
        isPlaying: r.isPlaying,
        syncEnabled: r.syncEnabled
      }));
    res.json(publicList);
  });

  // Highly robust helper for fast & bulletproof M3U parser
  function parseAndSaveM3UList(content: string, customCategory?: string): StreamItem[] {
    const parsedList: StreamItem[] = [];
    const lines = content.split(/\r?\n/);
    let currentItem: Partial<StreamItem> = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith("#EXTINF:")) {
        currentItem = { sourceType: "m3u" };
        
        // Match Name: trailing comma name extraction (most reliable standard)
        const lastCommaIndex = line.lastIndexOf(",");
        if (lastCommaIndex !== -1) {
          currentItem.name = line.substring(lastCommaIndex + 1).trim();
        }

        // Helper regex matching for attributes (allow single quote, double quote, or no quote values)
        const parseAttr = (keyName: string): string => {
          const matchers = [
            new RegExp(`${keyName}\\s*=\\s*"([^"]+)"`, "i"),
            new RegExp(`${keyName}\\s*=\\s*'([^']+)'`, "i"),
            new RegExp(`${keyName}\\s*=\\s*([^\\s,]+)`, "i")
          ];
          for (const rx of matchers) {
            const m = line.match(rx);
            if (m && m[1]) return m[1].trim();
          }
          return "";
        };

        const group = parseAttr("group-title") || parseAttr("category");
        if (group) currentItem.category = group;

        const logo = parseAttr("tvg-logo") || parseAttr("logo") || parseAttr("tvg-logoUrl");
        if (logo) currentItem.logo = logo;

        const tvgName = parseAttr("tvg-name") || parseAttr("tvg-id");
        if (!currentItem.name && tvgName) {
          currentItem.name = tvgName;
        }
      } else if (!line.startsWith("#")) {
        // It's a stream URL, save previous EXTINF item or auto-generate
        const streamUrl = line;
        let name = currentItem.name;
        if (!name) {
          try {
            const tempUrl = new URL(streamUrl);
            const filename = tempUrl.pathname.substring(tempUrl.pathname.lastIndexOf("/") + 1);
            name = filename ? filename.replace(/\.[^/.]+$/, "") : "Unnamed Channel";
            name = decodeURIComponent(name).replace(/[_-]/g, " ");
          } catch {
            name = "Direct Channel Stream";
          }
        }

        const id = "s_m3u_" + Math.random().toString(36).substr(2, 9);
        const stream: StreamItem = {
          id,
          name,
          url: streamUrl,
          logo: currentItem.logo || "",
          category: currentItem.category || customCategory || "Imported M3U",
          sourceType: "m3u",
          featured: false,
          status: "online",
          createdAt: Date.now()
        };

        streams.set(id, stream);
        parsedList.push(stream);
        currentItem = {};
      }
    }
    return parsedList;
  }

  // M3U Playlist Parser and Bulk importer
  app.post("/api/admin/iptv/m3u", (req, res) => {
    const { m3uContent } = req.body;
    if (!m3uContent) {
      return res.status(400).json({ error: "m3uContent is required" });
    }
    try {
      const parsed = parseAndSaveM3UList(m3uContent);
      io.emit("streams_list", Array.from(streams.values()));
      res.json({ success: true, count: parsed.length, streams: parsed });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to parse M3U content: " + err.message });
    }
  });

  // M3U Remote URL Importer and Auto-detector
  app.post("/api/admin/iptv/m3u-url", async (req, res) => {
    const { playlistUrl, customCategory } = req.body;
    if (!playlistUrl) {
      return res.status(400).json({ error: "playlistUrl is required" });
    }
    try {
      // Fetch contents from remote url
      const response = await fetch(playlistUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IPTV-Player-Hub"
        }
      });
      if (!response.ok) {
        throw new Error(`IPTV server returned HTTP status code ${response.status}`);
      }
      const rawText = await response.text();
      if (!rawText || !rawText.trim().startsWith("#EXTM3U")) {
        throw new Error("Target response does not start with EXTM3U. Be sure you entered a valid playlist.");
      }

      const parsed = parseAndSaveM3UList(rawText, customCategory || "Remote M3U Link");
      io.emit("streams_list", Array.from(streams.values()));
      res.json({ success: true, count: parsed.length, streams: parsed });
    } catch (err: any) {
      console.error("M3U Remote URL Import Error:", err);
      res.status(500).json({ error: err.message || "Failed to download/parse M3U playlist" });
    }
  });

  // Xtream Codes API Importer (Refined for browser compatibility)
  app.post("/api/admin/iptv/xtream", async (req, res) => {
    const { serverUrl, username, password } = req.body;
    if (!serverUrl || !username || !password) {
      return res.status(400).json({ error: "serverUrl, username, and password are required" });
    }
    try {
      const cleanUrl = serverUrl.endsWith("/") ? serverUrl.slice(0, -1) : serverUrl;
      const apiUrl = `${cleanUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams`;
      
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`Xtream Codes server returned status ${response.status}`);
      }
      
      const channels = await response.json() as any;
      const imported: StreamItem[] = [];
      
      if (Array.isArray(channels)) {
        channels.forEach((ch: any) => {
          // Playback compatibility: raw MPEG-TS (.ts) streams freeze in plain HTML5 tags.
          // Forcing 'm3u8' extension directs Xtream's server wrapper to output a compatible HLS stream.
          let ext = ch.container_extension || "m3u8";
          if (ext === "ts") {
            ext = "m3u8";
          }
          
          const streamUrl = `${cleanUrl}/live/${username}/${password}/${ch.stream_id || ch.id}.${ext}`;
          const id = "s_xtream_" + Math.random().toString(36).substr(2, 9);
          
          const item: StreamItem = {
            id,
            name: ch.name || `Xtream Channel ${ch.stream_id || ch.id}`,
            url: streamUrl,
            logo: ch.stream_icon || "",
            category: ch.category_name || "Xtream Channel",
            sourceType: "xtream",
            featured: false,
            status: "online",
            createdAt: Date.now()
          };
          
          streams.set(id, item);
          imported.push(item);
        });
      }
      
      io.emit("streams_list", Array.from(streams.values()));
      res.json({ success: true, count: imported.length, streams: imported });
    } catch (error: any) {
      console.error("Xtream Codes Import Error:", error);
      res.status(500).json({ error: error.message || "Failed to import from Xtream Codes" });
    }
  });

  // Stalker Portal Authenticated Importer
  app.post("/api/admin/iptv/stalker", async (req, res) => {
    const { portalUrl, macAddress } = req.body;
    if (!portalUrl || !macAddress) {
      return res.status(400).json({ error: "portalUrl and macAddress are required" });
    }
    try {
      const cleanUrl = portalUrl.endsWith("/") ? portalUrl.slice(0, -1) : portalUrl;
      // Stalker Portal action handshake
      const handshakeUrl = `${cleanUrl}/portal.php?type=itv&action=handshake&key=&mac=${encodeURIComponent(macAddress)}`;
      
      const handshakeResponse = await fetch(handshakeUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Referer": cleanUrl
        }
      });
      
      let token = "";
      if (handshakeResponse.ok) {
        const handshakeData = await handshakeResponse.json() as any;
        token = handshakeData?.js?.token || "";
      }
      
      let channelsUrl = `${cleanUrl}/portal.php?type=itv&action=get_all_channels`;
      if (token) {
        channelsUrl += `&token=${token}`;
      }
      
      const channelsResponse = await fetch(channelsUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Cookie": `mac=${encodeURIComponent(macAddress)}`,
          "Referer": cleanUrl,
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        }
      });
      
      if (!channelsResponse.ok) {
        throw new Error(`Channels request failed with status ${channelsResponse.status}`);
      }
      
      const channelsData = await channelsResponse.json() as any;
      const channels = channelsData?.js?.data || channelsData?.js || [];
      const imported: StreamItem[] = [];
      
      if (Array.isArray(channels)) {
        channels.forEach((ch: any) => {
          if (ch.name && (ch.cmd || ch.url)) {
            const id = "s_stalker_" + Math.random().toString(36).substr(2, 9);
            let streamUrl = ch.cmd || ch.url;
            if (streamUrl.startsWith("ffrt ")) {
              streamUrl = streamUrl.substring(5);
            }
            const item: StreamItem = {
              id,
              name: ch.name,
              url: streamUrl,
              logo: ch.logo || "",
              category: ch.category_name || "Stalker Channel",
              sourceType: "stalker",
              featured: false,
              status: "online",
              createdAt: Date.now()
            };
            streams.set(id, item);
            imported.push(item);
          }
        });
      }
      
      io.emit("streams_list", Array.from(streams.values()));
      res.json({ success: true, count: imported.length, streams: imported });
    } catch (error: any) {
      console.error("Stalker Portal Import Error:", error);
      res.status(500).json({ error: error.message || "Failed to import from Stalker Portal" });
    }
  });


  // ------------------------------------------------------------
  // Socket.IO Events Handler
  // ------------------------------------------------------------
  io.on("connection", (socket) => {
    console.log("User connected via socket.io:", socket.id);

    // Bootstrap local client with existing streams
    socket.emit("streams_list", Array.from(streams.values()));
    
    // Bootstrap public rooms list
    const publicList = Array.from(rooms.values())
      .filter(r => r.public)
      .map(r => ({
        id: r.id,
        name: r.name,
        userCount: r.users.length,
        mediaUrl: r.mediaUrl,
        mediaName: r.mediaName,
        isPlaying: r.isPlaying,
        syncEnabled: r.syncEnabled
      }));
    socket.emit("public_rooms_update", publicList);

    // Track chat messages slow-mode cooldown on server (5s throttle)
    const chatCooldowns = new Map<string, number>();

    // Listen to username assignment updates
    socket.on("set_username", ({ username }) => {
      sessions.set(socket.id, { username });
    });

    // Create a Watch Party Room
    socket.on("create_room", ({ name, mediaUrl, mediaName, public: isPublic, password, syncEnabled, username }, callback) => {
      // Generate short clean uppercase room code
      const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
      const chosenUsername = username || "Host_" + socket.id.substr(0, 4);
      sessions.set(socket.id, { username: chosenUsername });

      const newRoom: Room = {
        id: roomId,
        name: name || `Watch Room ${roomId}`,
        hostId: socket.id,
        mediaUrl: mediaUrl || "",
        mediaName: mediaName || "Custom Stream",
        currentTime: 0,
        isPlaying: false,
        public: isPublic ?? true,
        password: password || undefined,
        syncEnabled: syncEnabled ?? true,
        blockedUsers: [],
        users: [{ socketId: socket.id, username: chosenUsername, isHost: true }],
        messages: [],
        playlist: [],
        createdAt: Date.now(),
        lastActivity: Date.now()
      };

      rooms.set(roomId, newRoom);
      socket.join(roomId);

      if (callback) callback({ success: true, roomId, room: newRoom });
      broadcastPublicRooms();
    });

    // Join room event
    socket.on("join_room", ({ roomId, password, username }, callback) => {
      const upperRoomId = roomId ? roomId.trim().toUpperCase() : "";
      const room = rooms.get(upperRoomId) || rooms.get(roomId);
      if (!room) {
        if (callback) callback({ success: false, error: "Room not found" });
        return;
      }

      if (room.blockedUsers.includes(username)) {
        if (callback) callback({ success: false, error: "You are blocked from this room." });
        return;
      }

      if (room.password && room.password !== password) {
        if (callback) callback({ success: false, error: "Incorrect room password." });
        return;
      }

      // Associate socket session
      sessions.set(socket.id, { username });
      socket.join(room.id);

      // Idempotency check: don't duplicate
      const userExists = room.users.some(u => u.socketId === socket.id);
      if (!userExists) {
        const isHost = room.users.length === 0 || room.hostId === socket.id;
        room.users.push({ socketId: socket.id, username, isHost });
        if (isHost && room.hostId !== socket.id) {
          room.hostId = socket.id;
        }
      }

      room.lastActivity = Date.now();
      
      // Notify all members of new client joining
      io.to(room.id).emit("user_joined", { socketId: socket.id, username, isHost: room.hostId === socket.id });
      
      // Send fresh full room state to the late joiner
      socket.emit("room_state", room);

      if (callback) callback({ success: true, room });
      broadcastPublicRooms();
    });

    // Update Room Password (Host controls)
    socket.on("update_room_password", ({ roomId, password }) => {
      const room = rooms.get(roomId);
      if (!room || room.hostId !== socket.id) return;
      room.password = password ? password.trim() : undefined;
      io.to(roomId).emit("room_state", room);
      broadcastPublicRooms();
    });

    // Add Stream Link to Room Playlist (Host controls)
    socket.on("add_room_playlist_item", ({ roomId, name, url, logo }) => {
      const room = rooms.get(roomId);
      if (!room || room.hostId !== socket.id) return;
      if (!room.playlist) room.playlist = [];
      room.playlist.push({ name, url, logo });
      io.to(roomId).emit("room_state", room);
    });

    // Remove Stream Link from Room Playlist (Host controls)
    socket.on("remove_room_playlist_item", ({ roomId, index }) => {
      const room = rooms.get(roomId);
      if (!room || room.hostId !== socket.id) return;
      if (room.playlist && room.playlist[index]) {
        room.playlist.splice(index, 1);
      }
      io.to(roomId).emit("room_state", room);
    });

    // Dynamically change room active stream link (Host controls)
    socket.on("change_room_stream", ({ roomId, name, url, logo }) => {
      const room = rooms.get(roomId);
      if (!room || room.hostId !== socket.id) return;
      room.mediaUrl = url;
      room.mediaName = name;
      room.currentTime = 0;
      room.isPlaying = false;
      io.to(roomId).emit("room_state", room);
      broadcastPublicRooms();
    });

    // Leave room
    socket.on("leave_room", ({ roomId }) => {
      handleLeaveRoom(socket, roomId);
    });

    // Sync Playback: Play
    socket.on("play", ({ roomId, currentTime }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      
      room.isPlaying = true;
      if (currentTime !== undefined) {
        room.currentTime = currentTime;
      }
      room.lastActivity = Date.now();

      // Emit play event to everyone else
      socket.to(roomId).emit("play", { currentTime: room.currentTime });
    });

    // Sync Playback: Pause
    socket.on("pause", ({ roomId, currentTime }) => {
      const room = rooms.get(roomId);
      if (!room) return;

      room.isPlaying = false;
      if (currentTime !== undefined) {
        room.currentTime = currentTime;
      }
      room.lastActivity = Date.now();

      // Emit pause event to everyone else
      socket.to(roomId).emit("pause", { currentTime: room.currentTime });
    });

    // Sync Playback: Seek / Scrubbing
    socket.on("seek", ({ roomId, currentTime }) => {
      const room = rooms.get(roomId);
      if (!room) return;

      room.currentTime = currentTime;
      room.lastActivity = Date.now();

      // Emit seek broadcast to everyone else
      socket.to(roomId).emit("seek", { currentTime });
    });

    // Periodic Heartbeat synchronization from host
    socket.on("sync_state", ({ roomId, currentTime, isPlaying }) => {
      const room = rooms.get(roomId);
      if (!room) return;

      if (room.hostId === socket.id) {
        room.currentTime = currentTime;
        room.isPlaying = isPlaying;
        room.lastActivity = Date.now();

        // Broadcast current state to all remaining clients for drift correction
        socket.to(roomId).emit("sync_state", { currentTime, isPlaying });
      }
    });

    // Join direct watch/chat channel
    socket.on("join_direct_chat", ({ streamId }) => {
      const chatRoomId = `chat:stream:${streamId}`;
      socket.join(chatRoomId);
      
      // Fetch current messages from this stream chat
      const chat = chatStreams.get(chatRoomId) || { messages: [] };
      socket.emit("direct_chat_history", { streamId, messages: chat.messages });
    });

    // Sent text or sticker message
    socket.on("chat_message", ({ roomId, content, type, replyTo, username: customUsername }) => {
      // 5s Cooldown rate limiter
      const now = Date.now();
      const lastSentStamp = chatCooldowns.get(socket.id) || 0;
      if (now - lastSentStamp < 5000) {
        return; // Suppress client bypass
      }
      chatCooldowns.set(socket.id, now);

      const username = customUsername || sessions.get(socket.id)?.username || "Anonymous";
      const expiresAt = Date.now() + 3 * 60 * 1000; // 3 minutes expiration payload

      const message: Message = {
        id: "msg_" + Math.random().toString(36).substr(2, 9),
        username,
        content,
        type: type || "text",
        timestamp: Date.now(),
        replyTo,
        reactions: {},
        expiresAt
      };

      if (roomId.startsWith("chat:stream:")) {
        let streamChat = chatStreams.get(roomId);
        if (!streamChat) {
          streamChat = { messages: [] };
          chatStreams.set(roomId, streamChat);
        }
        streamChat.messages.push(message);
        // Force delete oldest after 100 messages total
        if (streamChat.messages.length > 100) {
          streamChat.messages = streamChat.messages.slice(-100);
        }
        io.to(roomId).emit("chat_message", message);
      } else {
        const room = rooms.get(roomId);
        if (room) {
          room.messages.push(message);
          room.lastActivity = Date.now();
          // Force delete oldest after 100 messages total
          if (room.messages.length > 100) {
            room.messages = room.messages.slice(-100);
          }
          io.to(roomId).emit("chat_message", message);
        }
      }
    });

    // Voice message payload (Base64 audio)
    socket.on("voice_message", ({ roomId, audioBlobBase64, username: customUsername }) => {
      // 5s Cooldown rate limiter
      const now = Date.now();
      const lastSentStamp = chatCooldowns.get(socket.id) || 0;
      if (now - lastSentStamp < 5000) {
        return; // Suppress
      }
      chatCooldowns.set(socket.id, now);

      const username = customUsername || sessions.get(socket.id)?.username || "Anonymous";
      const expiresAt = Date.now() + 3 * 60 * 1000; // 3 mins default

      const message: Message = {
        id: "msg_" + Math.random().toString(36).substr(2, 9),
        username,
        content: audioBlobBase64,
        type: "voice",
        timestamp: Date.now(),
        reactions: {},
        expiresAt
      };

      if (roomId.startsWith("chat:stream:")) {
        let streamChat = chatStreams.get(roomId);
        if (!streamChat) {
          streamChat = { messages: [] };
          chatStreams.set(roomId, streamChat);
        }
        streamChat.messages.push(message);
        // Trim messages history count to 100
        if (streamChat.messages.length > 100) {
          streamChat.messages = streamChat.messages.slice(-100);
        }
        io.to(roomId).emit("chat_message", message);
      } else {
        const room = rooms.get(roomId);
        if (room) {
          room.messages.push(message);
          room.lastActivity = Date.now();
          // Trim messages history count to 100
          if (room.messages.length > 100) {
            room.messages = room.messages.slice(-100);
          }
          io.to(roomId).emit("chat_message", message);
        }
      }
    });

    // Message replication emoji reaction
    socket.on("message_reaction", ({ roomId, messageId, reaction, username }) => {
      let messages: Message[] = [];
      if (roomId.startsWith("chat:stream:")) {
        messages = chatStreams.get(roomId)?.messages || [];
      } else {
        messages = rooms.get(roomId)?.messages || [];
      }

      const msg = messages.find(m => m.id === messageId);
      if (msg) {
        if (!msg.reactions[reaction]) {
          msg.reactions[reaction] = [];
        }
        
        if (!msg.reactions[reaction].includes(username)) {
          msg.reactions[reaction].push(username);
        } else {
          // Toggle off
          msg.reactions[reaction] = msg.reactions[reaction].filter((u: string) => u !== username);
          if (msg.reactions[reaction].length === 0) {
            delete msg.reactions[reaction];
          }
        }
        io.to(roomId).emit("message_reaction_update", { messageId, reactions: msg.reactions });
      }
    });

    // Moderation: Kick user
    socket.on("kick_user", ({ roomId, targetSocketId }) => {
      const room = rooms.get(roomId);
      if (!room || room.hostId !== socket.id) return;

      const targetUser = room.users.find(u => u.socketId === targetSocketId);
      if (targetUser) {
        io.to(targetSocketId).emit("kicked", { roomId });
        
        // Evict from socket.io room container
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
          targetSocket.leave(roomId);
        }

        room.users = room.users.filter(u => u.socketId !== targetSocketId);
        io.to(roomId).emit("user_left", { socketId: targetSocketId, username: targetUser.username, kicked: true });
        broadcastPublicRooms();
      }
    });

    // Moderation: Block user from room
    socket.on("block_user", ({ roomId, targetUsername }) => {
      const room = rooms.get(roomId);
      if (!room || room.hostId !== socket.id) return;

      if (!room.blockedUsers.includes(targetUsername)) {
        room.blockedUsers.push(targetUsername);
      }

      const toKick = room.users.filter(u => u.username === targetUsername);
      toKick.forEach(user => {
        io.to(user.socketId).emit("blocked", { roomId });
        const targetSocket = io.sockets.sockets.get(user.socketId);
        if (targetSocket) {
          targetSocket.leave(roomId);
        }
        room.users = room.users.filter(u => u.socketId !== user.socketId);
        io.to(roomId).emit("user_left", { socketId: user.socketId, username: user.username, blocked: true });
      });

      broadcastPublicRooms();
    });

    // Disconnection monitor
    socket.on("disconnect", () => {
      for (const [roomId, room] of rooms.entries()) {
        const user = room.users.find(u => u.socketId === socket.id);
        if (user) {
          handleLeaveRoom(socket, roomId);
        }
      }
      sessions.delete(socket.id);
    });
  });

  // ------------------------------------------------------------
  // Maintenance Sweepers & Monitoring
  // ------------------------------------------------------------

  // Clean empty or idle rooms (runs every 30 seconds for responsive recycling)
  setInterval(() => {
    const now = Date.now();
    // Sweeper for rooms
    for (const [roomId, room] of rooms.entries()) {
      const isEmptyGraceExpired = room.users.length === 0 && (now - room.lastActivity > 15 * 1000); // 15 seconds grace period
      const isInactive = now - room.lastActivity > 4 * 60 * 60 * 1000; // 4 hours
      if (isEmptyGraceExpired || isInactive) {
        io.to(roomId).emit("room_deleted", roomId);
        rooms.delete(roomId);
      }
    }
    broadcastPublicRooms();
  }, 30 * 1000);

  // Sweeper for Expired Chat Messages (runs every 15 seconds)
  setInterval(() => {
    const now = Date.now();
    let changed = false;

    for (const [chatId, record] of chatStreams.entries()) {
      const originalLength = record.messages.length;
      record.messages = record.messages.filter(msg => {
        const keep = msg.expiresAt > now;
        if (!keep) changed = true;
        return keep;
      });
      if (record.messages.length !== originalLength) {
        io.to(chatId).emit("chat_messages_cleared", { messages: record.messages });
      }
    }

    for (const [roomId, room] of rooms.entries()) {
      const originalLength = room.messages.length;
      room.messages = room.messages.filter(msg => {
        const keep = msg.expiresAt > now;
        if (!keep) changed = true;
        return keep;
      });
      if (room.messages.length !== originalLength) {
        io.to(roomId).emit("chat_messages_cleared", { messages: room.messages });
      }
    }
  }, 15 * 1000);

  // Background stream monitoring routine (runs every 60 seconds)
  async function monitorStreams() {
    for (const [id, stream] of streams.entries()) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        
        let online = false;
        try {
          const res = await fetch(stream.url, { method: "HEAD", signal: controller.signal });
          online = res.ok;
        } catch {
          // Retry with partial byte load GET if HEAD is filtered/disallowed
          const res = await fetch(stream.url, { 
            method: "GET", 
            signal: controller.signal,
            headers: { Range: "bytes=0-100" } 
          });
          online = res.ok;
        }
        
        clearTimeout(timeout);
        const isProtectedDefault = id === "s_tears" || id === "s_bbb" || id === "s_sintel" || id === "s_test_stream";
        const newStatus = online ? "online" : "offline";
        
        if (newStatus === "offline" && !isProtectedDefault) {
          streams.delete(id);
          io.emit("streams_list", Array.from(streams.values()));
        } else if (stream.status !== newStatus) {
          stream.status = newStatus;
          streams.set(id, stream);
          io.emit("stream_status", { id, status: newStatus });
        }
      } catch (err) {
        const isProtectedDefault = id === "s_tears" || id === "s_bbb" || id === "s_sintel" || id === "s_test_stream";
        if (!isProtectedDefault) {
          streams.delete(id);
          io.emit("streams_list", Array.from(streams.values()));
        } else if (stream.status !== "offline") {
          stream.status = "offline";
          streams.set(id, stream);
          io.emit("stream_status", { id, status: "offline" });
        }
      }
    }
  }

  // Run the monitor instantly, then repeat every minute
  monitorStreams();
  setInterval(monitorStreams, 60 * 1000);


  // ------------------------------------------------------------
  // Vite Integration (Asset Serving & SPA Router fallback)
  // ------------------------------------------------------------
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on IP 0.0.0.0 and port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Failed to start fullstack server error:", err);
});
