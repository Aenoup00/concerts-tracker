const express = require("express");
const session = require("express-session");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const auth = require("./authentificationRutes.js");
const passHelper = require("./password.js");
const audit = require("./audit.js");

const server = express();
const PORT = process.env.PORT || 12471;

// --- SCHÉMAS MONGODB ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: String,
    admin: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false }
});

const ConcertSchema = new mongoose.Schema({
    username: { type: String, required: true },
    past: [{
        artist: String,
        date: String,
        location: String,
        rating: Number
    }],
    future: [{
        artist: String,
        song: String
    }]
});

const AlbumSchema = new mongoose.Schema({
    username: { type: String, required: true },
    artist: { type: String, required: true },
    album: { type: String, required: true },
    format: { type: String, enum: ['vinyl', 'cd'], required: true }
});

const RecommendationSchema = new mongoose.Schema({
    username: String,
    type: String,
    title: String,
    reason: String,
    date: { type: Date, default: Date.now }
});

// Enregistrement des Modèles
const User = mongoose.model("User", UserSchema);
const Concert = mongoose.model("Concert", ConcertSchema);
const Album = mongoose.model("Album", AlbumSchema);
const Recommendation = mongoose.model("Recommendation", RecommendationSchema);

// --- CONNEXION MONGODB & MIGRATION ---
const MONGO_URI = "mongodb+srv://pereiraaenor00_db_user:8ONQA1y94fbXSYFF@myconcerts.cspi3v1.mongodb.net/?appName=MyConcerts"

mongoose.connect(MONGO_URI)
    .then(async () => {
        console.log("Connected to MongoDB Atlas");
        await initAndMigrateData();
    })
    .catch((err) => console.error("MongoDB Connection Error:", err));

// Initialisation de l'admin + Migration des fichiers JSON
async function initAndMigrateData() {
    try {
        // 1. Migration / création Utilisateurs
        const usersPath = path.join(__dirname, "data", "sessions.json");
        if (fs.existsSync(usersPath)) {
            const usersData = JSON.parse(fs.readFileSync(usersPath, "utf8") || "[]");
            for (const u of usersData) {
                await User.updateOne(
                    { username: u.username },
                    { $setOnInsert: { username: u.username, password: u.password, name: u.name, admin: u.admin, isBlocked: Boolean(u.isBlocked) } },
                    { upsert: true }
                );
            }
            console.log("--> Migration des utilisateurs terminée.");
        }

        // Si aucun compte n'existe du tout, créer l'admin par défaut
        const userCount = await User.countDocuments();
        if (userCount === 0) {
            const adminUsername = "admin";
            const adminPassword = "adminpassword123";
            const hashedPassword = passHelper.createSHA256v2(adminPassword, adminUsername);

            await User.create({
                username: adminUsername,
                password: hashedPassword,
                name: "Administrator",
                admin: true,
                isBlocked: false
            });
            console.log(`=== COMPTE ADMIN CRÉÉ : ${adminUsername} / ${adminPassword} ===`);
        }

        // 2. Migration Concerts
        const concertsPath = path.join(__dirname, "data", "user_concerts.json");
        if (fs.existsSync(concertsPath)) {
            const concertsData = JSON.parse(fs.readFileSync(concertsPath, "utf8") || "[]");
            for (const c of concertsData) {
                await Concert.updateOne(
                    { username: c.username },
                    { $setOnInsert: { username: c.username, past: c.past || [], future: c.future || [] } },
                    { upsert: true }
                );
            }
            console.log("--> Migration des concerts terminée.");
        }

        // 3. Migration Recommandations
        const recsPath = path.join(__dirname, "data", "recommendations.json");
        if (fs.existsSync(recsPath)) {
            const recsData = JSON.parse(fs.readFileSync(recsPath, "utf8") || "[]");
            for (const r of recsData) {
                const exists = await Recommendation.findOne({ title: r.title, username: r.username });
                if (!exists) {
                    await Recommendation.create(r);
                }
            }
            console.log("--> Migration des recommandations terminée.");
        }
    } catch (err) {
        console.error("Erreur durant l'initialisation / migration :", err);
    }
}

// --- MIDDLEWARES ---
server.use(express.urlencoded({ extended: true }));
server.use(express.json());

server.use(
    session({
        secret: "this is my secret key for the session",
        saveUninitialized: true,
        cookie: { maxAge: 1000 * 60 * 60 * 3 },
        resave: false,
    }),
);

server.use("/img", express.static("img"));
server.use(express.static("public"));

// --- PAGES HTML ---
server.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.get("/login", (req, res) => {
    auth.loginPage(req, res);
});

server.post("/checkLogin", (req, res) => {
    auth.checkLogin(req, res);
});

server.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/login");
    });
});

server.get("/add.html", (req, res) => {
    if (!req.session.username) return res.redirect("/login");
    res.sendFile(path.join(__dirname, "public", "add.html"));
});

server.get("/pf.html", (req, res) => {
    if (!req.session.username) return res.redirect("/login");
    res.sendFile(path.join(__dirname, "public", "pf.html"));
});

server.get("/shopping.html", (req, res) => {
    if (!req.session.username) return res.redirect("/login");
    res.sendFile(path.join(__dirname, "public", "shopping.html"));
});

server.get("/admin", (req, res) => {
    if (!req.session.username) return res.redirect("/login");
    if (req.session.admin !== true) return res.redirect("/");
    res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// --- API UTILISATEURS ---
server.get("/api/me", (req, res) => {
    if (!req.session || !req.session.username) {
        return res.json({ loggedIn: false });
    }
    return res.json({
        loggedIn: true,
        username: req.session.username,
        admin: Boolean(req.session.admin),
    });
});

server.post("/addNewUser", async (req, res) => {
    if (!req.session.username || req.session.admin !== true) {
        return res.redirect("/login");
    }

    const { username, password, name } = req.body;
    if (!username || !password) return res.redirect("/admin");

    try {
        const existingUser = await User.findOne({ username: new RegExp(`^${username.trim()}$`, "i") });
        if (existingUser) return res.redirect("/admin?error=user_exists");

        const hashedPassword = passHelper.createSHA256v2(password, username);
        await User.create({
            admin: false,
            name: name,
            username: username,
            password: hashedPassword,
        });

        res.redirect("/admin");
    } catch (err) {
        res.status(500).send("Database error");
    }
});

// --- RECOMMENDATIONS ---
server.get("/recommendations", async (req, res) => {
    try {
        const recs = await Recommendation.find().sort({ date: -1 });
        res.json(recs);
    } catch (err) {
        res.json([]);
    }
});

server.post("/recommendations", async (req, res) => {
    try {
        await Recommendation.create({
            username: req.body.username,
            type: req.body.type,
            title: req.body.title,
            reason: req.body.reason,
        });
        res.redirect("/#form");
    } catch (err) {
        res.redirect("/#form");
    }
});

// --- CONCERTS ---
server.post("/concerts/past", async (req, res) => {
    if (!req.session || !req.session.username) return res.redirect("/login");

    let record = await Concert.findOne({ username: req.session.username });
    if (!record) record = new Concert({ username: req.session.username, past: [], future: [] });

    record.past.push({
        artist: req.body.artist,
        date: req.body.date,
        location: req.body.location,
        rating: req.body.rating,
    });

    await record.save();
    res.redirect("/pf.html");
});

server.post("/concerts/future", async (req, res) => {
    if (!req.session || !req.session.username) return res.redirect("/login");

    let record = await Concert.findOne({ username: req.session.username });
    if (!record) record = new Concert({ username: req.session.username, past: [], future: [] });

    record.future.push({
        artist: req.body.artist,
        song: req.body.song,
    });

    await record.save();
    res.redirect("/pf.html");
});

server.get("/api/my-concerts", async (req, res) => {
    if (!req.session || !req.session.username) return res.status(401).json({ error: "Not connected" });

    const record = await Concert.findOne({ username: req.session.username });
    res.json({
        past: record ? record.past : [],
        future: record ? record.future : [],
    });
});

server.get("/api/concerts", async (req, res) => {
    const allRecords = await Concert.find();
    let publicConcerts = [];
    let idCounter = 1;

    allRecords.forEach((userRecord) => {
        if (Array.isArray(userRecord.past)) {
            userRecord.past.forEach((concert) => {
                publicConcerts.push({
                    id: idCounter++,
                    artist: concert.artist,
                    date: concert.date,
                    location: concert.location,
                    rating: concert.rating || null,
                });
            });
        }
    });

    res.json(publicConcerts);
});

server.get("/api/concerts/:id", async (req, res) => {
    const concertId = parseInt(req.params.id, 10);
    const allRecords = await Concert.find();
    let publicConcerts = [];
    let idCounter = 1;

    allRecords.forEach((userRecord) => {
        if (Array.isArray(userRecord.past)) {
            userRecord.past.forEach((concert) => {
                publicConcerts.push({
                    id: idCounter++,
                    artist: concert.artist,
                    date: concert.date,
                    location: concert.location,
                    rating: concert.rating || null,
                });
            });
        }
    });

    const found = publicConcerts.find((c) => c.id === concertId);
    if (!found) return res.status(404).json({ error: "Concert not found" });
    res.json(found);
});

// --- ALBUMS / VINYLES / CDS ---
server.post("/albums/wishlist", async (req, res) => {
    if (!req.session || !req.session.username) return res.redirect("/login");

    await Album.create({
        username: req.session.username,
        artist: req.body.artist,
        album: req.body.album,
        format: req.body.format,
    });

    res.redirect("/shopping.html");
});

server.get("/api/my-albums", async (req, res) => {
    if (!req.session || !req.session.username) return res.status(401).json({ error: "Not connected" });

    const items = await Album.find({ username: req.session.username });
    res.json(items);
});

// --- ADMIN ---
function isAdmin(req, res, next) {
    if (req.session && req.session.username && req.session.admin === true) {
        return next();
    }
    return res.status(403).json({ error: "Access denied" });
}

server.get("/api/admin/users", isAdmin, async (req, res) => {
    const users = await User.find();
    const safeUsers = users.map((u) => ({
        username: u.username,
        name: u.name,
        admin: u.admin,
        isBlocked: Boolean(u.isBlocked),
    }));
    res.json(safeUsers);
});

server.post("/api/admin/toggle-block", isAdmin, async (req, res) => {
    const { targetUsername } = req.body;
    const user = await User.findOne({ username: new RegExp(`^${targetUsername}$`, "i") });

    if (user) {
        if (user.admin) return res.status(400).json({ error: "Impossible to block an Admin" });

        user.isBlocked = !user.isBlocked;
        await user.save();

        const statusAction = user.isBlocked ? "BLOCKED_USER" : "UNBLOCKED_USER";
        audit.logAction(req.session.username, `${statusAction}: ${targetUsername}`);

        return res.json({ success: true, isBlocked: user.isBlocked });
    }

    res.status(404).json({ error: "User not found" });
});

// Lancement du serveur
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});