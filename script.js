// 获取DOM元素
const localVideo = document.getElementById('localVideo');
const videoGrid = document.getElementById('videoGrid');
const startButton = document.getElementById('startButton');
const toggleVideoButton = document.getElementById('toggleVideoButton');
const toggleAudioButton = document.getElementById('toggleAudioButton');
const userCountSpan = document.getElementById('userCount');

// WebRTC配置
const configuration = {
    iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
};

let localStream;
let ws;
let localId;
let peerConnectionsOfferFromMe = new Map(); // 我发起的连接
let peerConnectionsOfferFromThem = new Map(); // 接收到的连接

// 生成随机ID
function generateId() {
    return Math.random().toString(36).substring(2, 15);
}

// 连接信令服务器
function connectSignalingServer() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('已连接到信令服务器');
        ws.send(JSON.stringify({
            type: 'register', id: localId
        }));
    };

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        console.log('收到消息:', message.type);

        switch (message.type) {
            case 'room-users':
                handleRoomUsers(message.users);
                break;
            case 'user-joined':
                handleUserJoined(message.userId);
                break;
            case 'user-left':
                handleUserLeft(message.userId);
                break;
            case 'offer':
                await handleOffer(message);
                break;
            case 'answer':
                await handleAnswer(message);
                break;
            case 'ice-candidate':
                await handleIceCandidate(message);
                break;
        }
    };

    ws.onclose = () => {
        console.log('与信令服务器的连接已断开');
    };

    ws.onerror = (error) => {
        console.error('WebSocket错误:', error);
    };
}

// 处理房间用户列表
function handleRoomUsers(users) {
    console.log('处理房间用户列表:', users);
    // 清理不存在的连接
    cleanupConnections(users);
    // 创建新连接
    users.forEach(userId => {
        if (!peerConnectionsOfferFromMe.has(userId)) {
            console.log("创建到用户的连接:", userId);
            createPeerConnection(userId);
        }
    });
    updateUserCount();
}

// 清理不存在的连接
function cleanupConnections(activeUsers) {
    // 清理我发起的连接
    for (const [userId, connection] of peerConnectionsOfferFromMe.entries()) {
        if (!activeUsers.includes(userId)) {
            console.log('清理我发起的连接:', userId);
            connection.close();
            peerConnectionsOfferFromMe.delete(userId);
            removeVideoElement(userId);
        }
    }
    // 清理接收到的连接
    for (const [userId, connection] of peerConnectionsOfferFromThem.entries()) {
        if (!activeUsers.includes(userId)) {
            console.log('清理接收到的连接:', userId);
            connection.close();
            peerConnectionsOfferFromThem.delete(userId);
            removeVideoElement(userId);
        }
    }
}

// 处理新用户加入
async function handleUserJoined(userId) {
    console.log('新用户加入:', userId);
    if (!peerConnectionsOfferFromMe.has(userId)) {
        console.log("创建到新用户的连接:", userId);
        createPeerConnection(userId);
    }
    updateUserCount();
}

// 处理用户离开
function handleUserLeft(userId) {
    console.log('用户离开:', userId);
    // 清理我发起的连接
    if (peerConnectionsOfferFromMe.has(userId)) {
        peerConnectionsOfferFromMe.get(userId).close();
        peerConnectionsOfferFromMe.delete(userId);
    }
    // 清理接收到的连接
    if (peerConnectionsOfferFromThem.has(userId)) {
        peerConnectionsOfferFromThem.get(userId).close();
        peerConnectionsOfferFromThem.delete(userId);
    }
    removeVideoElement(userId);
    updateUserCount();
}

// 处理收到的offer
async function handleOffer(message) {
    console.log('处理offer:', message.sender);
    try {
        // 创建新的对等连接
        const peerConnection = new RTCPeerConnection(configuration);
        peerConnectionsOfferFromThem.set(message.sender, peerConnection);

        // 添加本地媒体流
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        // 处理远程媒体流
        peerConnection.ontrack = event => {
            console.log('收到远程媒体流:', message.sender);
            addVideoElement(message.sender, event.streams[0]);
        };

        // 处理ICE候选
        peerConnection.onicecandidate = event => {
            if (event.candidate) {
                ws.send(JSON.stringify({
                    type: 'ice-candidate',
                    target: message.sender,
                    data: event.candidate
                }));
            }
        };

        // 设置远程描述
        await peerConnection.setRemoteDescription(new RTCSessionDescription(message.data));

        // 创建应答
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        // 发送应答
        ws.send(JSON.stringify({
            type: 'answer',
            target: message.sender,
            data: answer
        }));
    } catch (error) {
        console.error('处理offer失败:', error);
    }
}

// 处理收到的answer
async function handleAnswer(message) {
    console.log('处理answer:', message.sender);
    const peerConnection = peerConnectionsOfferFromMe.get(message.sender);
    if (peerConnection) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(message.data));
        } catch (error) {
            console.error('处理answer失败:', error);
        }
    }
}

// 处理收到的ICE候选
async function handleIceCandidate(message) {
    console.log('处理ICE候选:', message.sender);
    const peerConnection = peerConnectionsOfferFromMe.get(message.sender) ||
        peerConnectionsOfferFromThem.get(message.sender);
    if (peerConnection) {
        try {
            if (message.data) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(message.data));
            }
        } catch (error) {
            console.error('处理ICE候选失败:', error);
        }
    }
}

// 创建对等连接
function createPeerConnection(userId) {
    if (peerConnectionsOfferFromMe.has(userId)) {
        console.log('连接已存在:', userId);
        return;
    }

    console.log('创建对等连接:', userId);
    const peerConnection = new RTCPeerConnection(configuration);
    peerConnectionsOfferFromMe.set(userId, peerConnection);

    // 添加本地媒体流
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // 处理远程媒体流
    peerConnection.ontrack = event => {
        console.log('收到远程媒体流:', userId);
        addVideoElement(userId, event.streams[0]);
    };

    // 处理连接状态变化
    peerConnection.onconnectionstatechange = () => {
        console.log(`与用户 ${userId} 的连接状态:`, peerConnection.connectionState);
        if (peerConnection.connectionState === 'disconnected' ||
            peerConnection.connectionState === 'failed' ||
            peerConnection.connectionState === 'closed') {
            handleUserLeft(userId);
        }
    };

    // 处理ICE候选
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                target: userId,
                data: event.candidate
            }));
        }
    };

    // 创建并发送offer
    createAndSendOffer(userId);
}

// 创建并发送offer
async function createAndSendOffer(userId) {
    const peerConnection = peerConnectionsOfferFromMe.get(userId);
    if (peerConnection) {
        try {
            console.log('创建offer:', userId);
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            ws.send(JSON.stringify({
                type: 'offer',
                target: userId,
                data: offer
            }));
        } catch (error) {
            console.error('创建offer失败:', error);
        }
    }
}

// 添加视频元素
function addVideoElement(userId, stream) {
    console.log('添加视频元素:', userId);
    // 检查是否已存在视频元素
    const existingVideo = document.getElementById(`video-${userId}`);
    if (existingVideo) {
        console.log('视频元素已存在:', userId);
        return;
    }

    const videoBox = document.createElement('div');
    videoBox.className = 'video-box';
    videoBox.id = `video-${userId}`;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;

    const label = document.createElement('p');
    label.textContent = `用户 ${userId.substring(0, 6)}`;

    videoBox.appendChild(video);
    videoBox.appendChild(label);
    videoGrid.appendChild(videoBox);
}

// 移除视频元素
function removeVideoElement(userId) {
    console.log('移除视频元素:', userId);
    const videoBox = document.getElementById(`video-${userId}`);
    if (videoBox) {
        videoBox.remove();
    }
}

// 更新用户数量显示
function updateUserCount() {
    const count = peerConnectionsOfferFromMe.size + peerConnectionsOfferFromThem.size + 1; // +1 for local user
    userCountSpan.textContent = count;
}

// 初始化本地媒体流
async function startLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true, audio: true
        });
        localVideo.srcObject = localStream;
        startButton.disabled = true;
        toggleVideoButton.disabled = false;
        toggleAudioButton.disabled = false;

        // 生成本地ID
        localId = generateId();

        // 连接到信令服务器
        connectSignalingServer();
    } catch (error) {
        console.error('获取媒体设备失败:', error);
        alert('无法访问摄像头和麦克风，请确保已授予权限。');
    }
}

// 切换视频
function toggleVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            toggleVideoButton.textContent = videoTrack.enabled ? '关闭视频' : '开启视频';
            toggleVideoButton.classList.toggle('active');
        }
    }
}

// 切换音频
function toggleAudio() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            toggleAudioButton.textContent = audioTrack.enabled ? '关闭音频' : '开启音频';
            toggleAudioButton.classList.toggle('active');
        }
    }
}

// localId = generateId();
// connectSignalingServer();
// 事件监听
startButton.addEventListener('click', startLocalStream);
toggleVideoButton.addEventListener('click', toggleVideo);
toggleAudioButton.addEventListener('click', toggleAudio); 