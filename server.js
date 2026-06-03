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

// Nâng giới hạn kích thước dữ liệu nhận vào lên 50mb để xử lý chuỗi ảnh Base64
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

// ==================== CÁC API XÁC THỰC (AUTH ENDPOINTS) ====================

// 1. API ĐĂNG KÝ (Register)
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password, security_question, security_answer } = req.body;
    try {
        // Chỉ định rõ public.users
        const checkUser = await pool.query('SELECT * FROM public.users WHERE email = $1', [email]);
        if (checkUser.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Email này đã được sử dụng!' });
        }

        const newUser = await pool.query(
            `INSERT INTO public.users (username, email, password, security_question, security_answer) 
             VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email`,
            [username, email, password, security_question, security_answer]
        );

        res.status(201).json({ success: true, user: newUser.rows[0] });
    } catch (err) {
        console.error('❌ Lỗi đăng ký:', err);
        res.status(500).json({ success: false, message: 'Lỗi server khi đăng ký!' });
    }
});

// 2. API ĐĂNG NHẬP (Login)
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        // Chỉ định rõ public.users
        const result = await pool.query('SELECT * FROM public.users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'Email không tồn tại!' });
        }

        const user = result.rows[0];
        if (user.password !== password) {
            return res.status(400).json({ success: false, message: 'Mật khẩu không chính xác!' });
        }

        res.json({ 
            success: true, 
            user: { 
                id: user.id, 
                username: user.username, 
                email: user.email,
                avatar_url: user.avatar_url,
                security_question: user.security_question,
                security_answer: user.security_answer
            } 
        });
    } catch (err) {
        console.error('❌ Lỗi đăng nhập:', err);
        res.status(500).json({ success: false, message: 'Lỗi server khi đăng nhập!' });
    }
});

// 3. API LẤY CÂU HỎI BẢO MẬT
app.post('/api/auth/get-question', async (req, res) => {
    const { email } = req.body;
    try {
        // Chỉ định rõ public.users
        const result = await pool.query('SELECT security_question FROM public.users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'Email không tồn tại trong hệ thống!' });
        }
        res.json({ success: true, security_question: result.rows[0].security_question });
    } catch (err) {
        console.error('❌ Lỗi lấy câu hỏi bảo mật:', err);
        res.status(500).json({ success: false, message: 'Lỗi server!' });
    }
});

// 4. API KIỂM TRA CÂU TRẢ LỜI VÀ CẬP NHẬT MẬT KHẨU MỚI
app.post('/api/auth/reset-password', async (req, res) => {
    const { email, security_answer, new_password } = req.body;
    try {
        // Chỉ định rõ public.users
        const result = await pool.query('SELECT security_answer FROM public.users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'Email không tồn tại!' });
        }

        const user = result.rows[0];
        const savedAnswer = (user.security_answer || '').toLowerCase().trim();
        const inputAnswer = (security_answer || '').toLowerCase().trim();

        if (savedAnswer !== inputAnswer) {
            return res.status(400).json({ success: false, message: 'Câu trả lời bảo mật không chính xác!' });
        }

        // Chỉ định rõ public.users
        await pool.query('UPDATE public.users SET password = $1 WHERE email = $2', [new_password, email]);
        res.json({ success: true, message: 'Đặt lại mật khẩu mới thành công!' });
    } catch (err) {
        console.error('❌ Lỗi đặt lại mật khẩu:', err);
        res.status(500).json({ success: false, message: 'Lỗi server khi đổi mật khẩu!' });
    }
});

// ==================== API QUẢN LÝ TÀI KHOẢN (USER ENDPOINTS) ====================

// 5. API CẬP NHẬT THÔNG TIN TÀI KHOẢN
app.put('/api/users/update', async (req, res) => {
    const { email, username, security_question, security_answer, avatar_url } = req.body;
    try {
        // Chỉ định rõ public.users
        const checkUser = await pool.query('SELECT * FROM public.users WHERE email = $1', [email]);
        if (checkUser.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản để cập nhật!' });
        }

        // Chỉ định rõ public.users
        const queryUpdate = `
            UPDATE public.users 
            SET username = $1, security_question = $2, security_answer = $3, avatar_url = $4 
            WHERE email = $5 
            RETURNING id, username, email, avatar_url
        `;
        const values = [username, security_question, security_answer, avatar_url, email];
        const result = await pool.query(queryUpdate, values);

        res.json({ 
            success: true, 
            message: 'Cập nhật tài khoản thành công!', 
            user: result.rows[0] 
        });
    } catch (err) {
        console.error('❌ Lỗi cập nhật tài khoản:', err);
        res.status(500).json({ success: false, message: 'Lỗi server khi cập nhật tài khoản!' });
    }
});


// ==================== CẤU HÌNH SOCKET.IO TRUYỀN TIN REALTIME ====================

io.on('connection', (socket) => {
    console.log(`🔌 Thiết bị kết nối mới: ${socket.id}`);

    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        console.log(`📱 Thiết bị ${socket.id} đã vào phòng: ${roomId}`);
    });

    socket.on('send_message', async (data) => {
        const { room_id, sender_id, message_type, message_text, image_url } = data;
        try {
            // Lưu ý: Nếu bảng messages cũng lỗi tương tự, bạn có thể thêm public.messages
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