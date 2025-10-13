import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import bodyParser from "body-parser";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: "*" },
});

// 👇 هنا زد limit لـ 10gb
app.use(bodyParser.json({ limit: "10gb" }));
app.use(bodyParser.urlencoded({ limit: "2gb", extended: true }));

// endpoint يستقبل الإشعارات من Odoo
app.post("/websocket", (req, res) => {
    const { channel, data } = req.body;
    console.log(`📨 Reçu depuis Odoo - Channel: ${channel}, Data:`, data);

    // Parser les données si c'est un string JSON
    let parsedData;
    try {
        parsedData = typeof data === "string" ? JSON.parse(data) : data;
    } catch (e) {
        parsedData = data;
    }

    // Envoyer aux clients WebSocket
    io.emit(channel, JSON.stringify(parsedData));

    console.log(`✅ Message envoyé aux clients sur le channel: ${channel}`);
    res.json({ status: "ok", message: "Notification envoyée avec succès" });
});

httpServer.listen(4000, () => {
    console.log("WS Server running on http://localhost:4000");
});
