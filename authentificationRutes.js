const path = require("path");
const mongoose = require("mongoose");
const passHelper = require("./password.js");
const audit = require("./audit.js");

module.exports.loginPage = (req, res) => {
    let loginFailed = req.query.loginFailed;
    let blocked = req.query.error === "blocked";

    if (blocked) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Login Error</title></head>
            <body style="background:#0f172a; color:white; font-family:sans-serif;">
                <div id="loginFailed" style="color:#ef4444; font-size: 1.5rem; text-align: center; margin-top: 4rem;">
                    Your account has been blocked by an administrator.
                </div>
                <div style="text-align:center; margin-top: 1.5rem;">
                    <a href="/login" style="color:#38bdf8; text-decoration:none;">Back to login</a>
                </div>
            </body>
            </html>
        `);
    }

    if (loginFailed) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Login Error</title></head>
            <body style="background:#0f172a; color:white; font-family:sans-serif;">
                <div id="loginFailed" style="color:#ef4444; font-size: 1.5rem; text-align: center; margin-top: 4rem;">
                    Username and password do not match !
                </div>
                <div style="text-align:center; margin-top: 1.5rem;">
                    <a href="/login" style="color:#38bdf8; text-decoration:none;">Try again</a>
                </div>
            </body>
            </html>
        `);
    }

    res.sendFile(path.join(__dirname, "public", "login.html"));
};

module.exports.checkLogin = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.redirect("/login?loginFailed=true");
    }

    try {
        const User = mongoose.model("User");
        const hashedPassword = passHelper.createSHA256v2(password, username);

        // Recherche dans MongoDB sans sensibilité à la casse
        const user = await User.findOne({ 
            username: new RegExp(`^${username.trim()}$`, "i"),
            password: hashedPassword 
        });

        if (user) {
            if (user.isBlocked) {
                return res.redirect("/login?error=blocked");
            }

            // Chargement de la session
            req.session.username = user.username;
            req.session.admin = Boolean(user.admin);

            audit.logAction(user.username, "USER_LOGIN");

            if (user.admin === true) {
                return res.redirect("/admin");
            } else {
                return res.redirect("/");
            }
        } else {
            return res.redirect("/login?loginFailed=true");
        }
    } catch (err) {
        console.error("Login Database Error:", err);
        return res.redirect("/login?loginFailed=true");
    }
};