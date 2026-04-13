document.addEventListener("DOMContentLoaded", function () {
    let chats = JSON.parse(localStorage.getItem("chats")) || {};
    let currentChat = localStorage.getItem("currentChat") || Date.now().toString();

    if (!chats[currentChat]) chats[currentChat] = [];

    const messages = document.getElementById("messages");
    const input = document.getElementById("input");
    const historyList = document.getElementById("historyList");

    /* ENTER KEY */
    input.addEventListener("keydown", e => {
        if (e.key === "Enter") send();
    });

    /* SAVE */
    function save() {
        localStorage.setItem("chats", JSON.stringify(chats));
        localStorage.setItem("currentChat", currentChat);
    }

    /* NEW CHAT */
    function newChat() {
        currentChat = Date.now().toString();
        chats[currentChat] = [];
        save();
        loadChat();
    }

    /* LOAD CHAT */
    function loadChat() {
        messages.innerHTML = "";
        chats[currentChat].forEach(msg => {
            addMessage(msg.content, msg.role === "user" ? "user" : "ai");
        });
        renderHistory();
    }

    /* HISTORY SIDEBAR */
    function renderHistory() {
        historyList.innerHTML = "";
        Object.keys(chats).slice(-10).forEach(id => {
            let div = document.createElement("div");
            div.className = "chat-item";
            div.innerText = chats[id][0]?.content?.slice(0, 20) || "New Chat";
            div.onclick = () => {
                currentChat = id;
                save();
                loadChat();
            };
            historyList.appendChild(div);
        });
    }

    /* ADD MESSAGE */
    function addMessage(text, type) {
        const div = document.createElement("div");
        div.className = "msg " + type;
        div.innerText = text;
        messages.appendChild(div);
        messages.scrollTop = messages.scrollHeight;
    }

    /* SEND */
    async function send() {
        const text = input.value.trim();
        if (!text) return;

        addMessage(text, "user");
        chats[currentChat].push({ role: "user", content: text });
        input.value = "";

        const typing = document.createElement("div");
        typing.className = "typing";
        typing.innerText = "Thinking...";
        messages.appendChild(typing);

        try {
            const res = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text,
                    history: chats[currentChat]
                })
            });
            
            if (res.ok) {
                const data = await res.json();
                messages.removeChild(typing);

                addMessage(data.reply, "ai");
                chats[currentChat].push({ role: "assistant", content: data.reply });

                save();
                renderHistory();
            } else {
                console.error("Failed to fetch response from API:", res.status);
            }
        } catch (error) {
            console.error("Error sending message:", error);
            messages.removeChild(typing);
        }

    }

    /* INIT */
    loadChat();
});
