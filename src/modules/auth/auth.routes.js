const express = require("express");
const router = express.Router();
const AuthController = require("./auth.controller");
const authMiddleware = require("../../middlewares/auth.middleware");

router.post("/signup", (req, res) => AuthController.signup(req, res));
router.post("/login", (req, res) => AuthController.login(req, res));
router.post("/google", (req, res) => AuthController.googleLogin(req, res));
router.get("/me", authMiddleware, (req, res) => AuthController.me(req, res));
router.get("/stats", authMiddleware, (req, res) => AuthController.getStats(req, res));
router.put("/profile", authMiddleware, (req, res) => AuthController.updateProfile(req, res));
router.put("/password", authMiddleware, (req, res) => AuthController.changePassword(req, res));

module.exports = router;