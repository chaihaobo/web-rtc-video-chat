const express = require('express');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const path = require('path');

const app = express();

// 读取SSL证书
const options = {
    // key: fs.readFileSync(path.join(__dirname, 'certs', 'key.pem')),
    // cert: fs.readFileSync(path.join(__dirname, 'certs', 'cert.pem'))
};

const server = https.createServer(options, app);
const wss = new WebSocket.Server({server});

// 存储全局房间和客户端信息
const globalRoom = new Set(); // 存储所有连接的客户端ID
const clients = new Map(); // clientId -> {ws}

// 提供静态文件
app.use(express.static(path.join(__dirname)));

// WebSocket 连接处理
wss.on('connection', (ws) => {
    let clientId = null;
    let nickname = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'register':
                // 注册新客户端
                clientId = data.id;
                nickname = data.nickname || `用户${clientId.substring(0, 6)}`;
                clients.set(clientId, {ws, nickname});
                globalRoom.add(clientId);
                console.log(`客户端 ${clientId} (${nickname}) 已连接`);

                // 通知房间内其他用户有新用户加入
                globalRoom.forEach(memberId => {
                    const memberWs = clients.get(memberId).ws;
                    const roomMembers = Array.from(globalRoom).filter(id => id !== memberId);
                    memberWs.send(JSON.stringify({
                        type: 'room-users',
                        users: roomMembers.map(id => ({
                            id,
                            nickname: clients.get(id).nickname
                        }))
                    }));
                });
                break;

            case 'update-nickname':
                if (clientId) {
                    nickname = data.nickname;
                    clients.get(clientId).nickname = nickname;
                    // 广播昵称更新
                    globalRoom.forEach(memberId => {
                        const memberWs = clients.get(memberId).ws;
                        memberWs.send(JSON.stringify({
                            type: 'nickname-updated',
                            userId: clientId,
                            nickname: nickname
                        }));
                    });
                }
                break;

            case 'offer':
            case 'answer':
            case 'ice-candidate':
                // 转发信令消息给目标客户端
                const targetClient = clients.get(data.target);
                if (targetClient) {
                    targetClient.ws.send(JSON.stringify({
                        type: data.type,
                        sender: clientId,
                        from: data.from,
                        data: data.data
                    }));
                } else {
                    console.log(`目标客户端 ${data.target} 不存在`);
                }
                break;
        }
    });

    ws.on('close', () => {
        if (clientId) {
            // 从全局房间中移除
            globalRoom.delete(clientId);
            clients.delete(clientId);

            // 通知其他用户
            globalRoom.forEach(memberId => {
                const memberWs = clients.get(memberId).ws;
                memberWs.send(JSON.stringify({
                    type: 'user-left',
                    userId: clientId
                }));
            });

            console.log(`客户端 ${clientId} 已断开连接`);
        }
    });

    // 处理错误
    ws.on('error', (error) => {
        console.error('WebSocket错误:', error);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`HTTPS 服务器运行在 https://localhost:${PORT}`);
}); 