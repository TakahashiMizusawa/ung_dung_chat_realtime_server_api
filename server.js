const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
});

pool.connect((err, client, release) => {
    if (err) {
        return console.error('❌ Lỗi kết nối tới Aiven PostgreSQL:', err.stack);
    }
    console.log('✅ Kết nối tới Aiven PostgreSQL thành công!');
    release();
});

io.on('connection', (socket) => {
    console.log(`🔌 Thiết bị kết nối mới: ${socket.id}`);

    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        console.log(`📱 Thiết bị ${socket.id} đã vào phòng: ${roomId}`);
    });

    socket.on('send_message', async (data) => {
        const { room_id, sender_id, message_type, message_text, image_url } = data;
        try {
            const query = `
                INSERT INTO messages (room_id, sender_id, message_type, message_text, image_url) 
                VALUES ($1, $2, $3, $4, $5) RETURNING *`;
            const values = [room_id, sender_id, message_type, message_text, image_url];
            const res = await pool.query(query, values);
            const savedMessage = res.rows[0];

            console.log(`✉️ Tin nhắn mới: ${message_text || '[Hình ảnh]'}`);
            io.to(room_id).emit('receive_message', savedMessage);
        } catch (err) {
            console.error('❌ Lỗi lưu tin nhắn:', err);
        }
    });

    socket.on('disconnect', () => {
        console.log(`❌ Thiết bị ngắt kết nối: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server đang chạy tại port: ${PORT}`);
});