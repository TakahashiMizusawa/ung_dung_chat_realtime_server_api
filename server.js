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
        const checkUser = await pool.query('SELECT * FROM public.users WHERE email = $1', [email]);
        if (checkUser.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản để cập nhật!' });
        }

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

// 6. API TÌM KIẾM NGƯỜI DÙNG BẰNG QUERY PARAMETER
app.get('/api/users/search', async (req, res) => {
    const keyword = req.query.q; 
    
    if (!keyword) {
        return res.status(400).json({ success: false, message: 'Thiếu từ khóa tìm kiếm!' });
    }

    try {
        const queryText = `
            SELECT id, username, email, avatar_url 
            FROM public.users 
            WHERE username ILIKE $1 OR email ILIKE $1
        `;
        const result = await pool.query(queryText, [`%${keyword}%`]);
        
        res.json({ success: true, users: result.rows });
    } catch (err) {
        console.error('❌ Lỗi tìm kiếm người dùng:', err);
        res.status(500).json({ success: false, message: 'Lỗi server khi tìm kiếm!' });
    }
});

// ==================== CÁC API QUẢN LÝ BẠN BÈ (FRIEND ENDPOINTS) ====================

// 7. API GỬI LỜI MỜI KẾT BẠN
app.post('/api/friends/send-request', async (req, res) => {
    const { sender_id, receiver_id } = req.body;

    if (!sender_id || !receiver_id) {
        return res.status(400).json({ success: false, message: 'Thiếu thông tin người gửi hoặc người nhận!' });
    }

    try {
        const checkRequest = await pool.query(
            `SELECT * FROM public.friendships 
             WHERE (sender_id = $1 AND receiver_id = $2) 
                OR (sender_id = $2 AND receiver_id = $1)`,
            [sender_id, receiver_id]
        );

        if (checkRequest.rows.length > 0) {
            const status = checkRequest.rows[0].status;
            if (status === 'accepted') {
                return res.json({ success: false, message: 'Hai người đã là bạn bè rồi!' });
            }
            return res.json({ success: false, message: 'Lời mời đang chờ phản hồi hoặc đã được gửi!' });
        }

        await pool.query(
            `INSERT INTO public.friendships (sender_id, receiver_id, status) 
             VALUES ($1, $2, 'pending')`,
            [sender_id, receiver_id]
        );

        res.json({ success: true, message: 'Đã gửi lời mời kết bạn thành công!' });
    } catch (err) {
        console.error('❌ Lỗi gửi lời mời kết bạn:', err);
        res.status(500).json({ success: false, message: 'Lỗi hệ thống!' });
    }
});

// 8. API LẤY DANH SÁCH LỜI MỜI KẾT BẠN ĐANG CHỜ
app.get('/api/friends/requests/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const queryText = `
            SELECT f.id, f.sender_id, u.username AS sender_username, u.email AS sender_email, u.avatar_url
            FROM public.friendships f
            JOIN public.users u ON f.sender_id = u.id
            WHERE f.receiver_id = $1 AND f.status = 'pending'
        `;
        const result = await pool.query(queryText, [userId]);
        res.json({ success: true, requests: result.rows });
    } catch (err) {
        console.error('❌ Lỗi lấy danh sách lời mời:', err);
        res.status(500).json({ success: false, message: 'Lỗi hệ thống!' });
    }
});

// 9. API PHẢN HỒI LỜI MỜI KẾT BẠN (Chấp nhận / Từ chối)
app.post('/api/friends/respond-request', async (req, res) => {
    const { request_id, action } = req.body;
    try {
        if (action === 'accept') {
            await pool.query(
                "UPDATE public.friendships SET status = 'accepted' WHERE id = $1",
                [request_id]
            );
            res.json({ success: true, message: 'Đã đồng ý kết bạn!' });
        } else {
            await pool.query("DELETE FROM public.friendships WHERE id = $1", [request_id]);
            res.json({ success: true, message: 'Đã hủy lời mời kết bạn!' });
        }
    } catch (err) {
        console.error('❌ Lỗi phản hồi lời mời kết bạn:', err);
        res.status(500).json({ success: false, message: 'Lỗi hệ thống!' });
    }
});

// 10. API LẤY DANH SÁCH BẠN BÈ
app.get('/api/friends/list/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const queryText = `
            SELECT u.id, u.username, u.email, u.avatar_url
            FROM public.friendships f
            JOIN public.users u ON (f.sender_id = u.id AND f.receiver_id = $1) 
                               OR (f.receiver_id = u.id AND f.sender_id = $1)
            WHERE (f.sender_id = $1 OR f.receiver_id = $1) AND f.status = 'accepted'
        `;
        const result = await pool.query(queryText, [userId]);
        res.json({ success: true, friends: result.rows });
    } catch (err) {
        console.error('❌ Lỗi lấy danh sách bạn bè:', err);
        res.status(500).json({ success: false, message: 'Lỗi hệ thống!' });
    }
});

// ==================== CÁC API QUẢN LÝ TIN NHẮN (MESSAGE ENDPOINTS) ====================

// 11. API LẤY LỊCH SỬ TIN NHẮN GIỮA HAI NGƯỜI DÙNG (Mới bổ sung)
app.get('/api/messages/history', async (req, res) => {
    const { sender_id, receiver_id } = req.query;

    if (!sender_id || !receiver_id) {
        return res.status(400).json({ success: false, message: 'Thiếu thông tin người gửi hoặc nhận!' });
    }

    try {
        const queryText = `
            SELECT id, sender_id, receiver_id, message_text AS text, created_at AS time
            FROM public.messages
            WHERE (sender_id = $1 AND receiver_id = $2)
               OR (sender_id = $2 AND receiver_id = $1)
            ORDER BY created_at ASC
        `;
        const result = await pool.query(queryText, [sender_id, receiver_id]);
        res.json({ success: true, messages: result.rows });
    } catch (err) {
        console.error('❌ Lỗi lấy lịch sử tin nhắn từ DB:', err);
        res.status(500).json({ success: false, message: 'Lỗi hệ thống khi tải tin nhắn!' });
    }
});

// ==================== CẤU HÌNH SOCKET.IO TRUYỀN TIN REALTIME ====================

const onlineUsers = {};

io.on('connection', (socket) => {
    console.log(`🔌 Thiết bị kết nối mới: ${socket.id}`);

    socket.on('register_user', (userId) => {
        onlineUsers[userId] = socket.id;
        console.log(`👤 Người dùng [ID: ${userId}] đã online với SocketID: ${socket.id}`);
    });

    // Xử lý gửi tin nhắn Realtime và tự động Lưu vào Database
    socket.on('send_message', async (data) => {
        const { sender_id, receiver_id, text, time } = data;
        
        try {
            // Lưu tin nhắn vào cơ sở dữ liệu trước
            const queryInsert = `
                INSERT INTO public.messages (sender_id, receiver_id, message_text) 
                VALUES ($1, $2, $3) RETURNING id
            `;
            const result = await pool.query(queryInsert, [sender_id, receiver_id, text]);
            console.log(`💾 Đã lưu tin nhắn vào DB thành công (Msg ID: ${result.rows[0].id})`);

            // Tiến hành chuyển tiếp tin nhắn realtime qua Socket nếu đối phương đang online
            const receiverSocketId = onlineUsers[receiver_id];
            if (receiverSocketId) {
                io.to(receiverSocketId).emit('receive_message', {
                    sender_id: sender_id,
                    text: text,
                    time: time
                });
                console.log(`✉️ Đã chuyển tiếp tin nhắn qua Socket từ ${sender_id} tới ${receiver_id}`);
            }
        } catch (dbErr) {
            console.error('❌ Lỗi ghi nhận/gửi tin nhắn:', dbErr);
        }
    });

    socket.on('send_friend_request', (data) => {
        const { sender_id, sender_username, receiver_id } = data;
        const receiverSocketId = onlineUsers[receiver_id];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('new_friend_request', {
                sender_id: sender_id,
                sender_username: sender_username
            });
            console.log(`🔔 Đã đẩy thông báo kết bạn từ ${sender_username} tới ${receiver_id}`);
        }
    });

    socket.on('disconnect', () => {
        for (const userId in onlineUsers) {
            if (onlineUsers[userId] === socket.id) {
                delete onlineUsers[userId];
                console.log(`❌ Người dùng [ID: ${userId}] đã offline.`);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server đang chạy tại port: ${PORT}`);
});