
module.exports = function(RED) {
    "use strict";
    const zmq = require('zeromq');

    async function initSocketConnection(node) {
        try {
            if (node.isserver === true) {
                await node.sock.bind(node.server);
            } else {
                node.sock.connect(node.server);
            }
            node.status({ fill: "green", shape: "dot", text: "connected" });
            node.connected = true;
        } catch (e) {
            node.status({ fill: "red", shape: "ring", text: e.toString() });
            node.error(e);
        }
    }
    
    function processMessagePart(node, part, index) {
        if (index >= node.fields.length) {
            node.fields[index] = "part" + index;
        }
    
        let processedPart = part;
    
        if (node.output !== "buffer") {
            try {
                processedPart = part.toString();
            } catch (e) {
                node.error("Not a string", { error: true });
            }
        }
    
        if (node.output === "json") {
            try {
                processedPart = JSON.parse(processedPart);
            } catch (e) {}
        }
    
        return processedPart;
    }
    
    async function initZmqInNode(node) {
        node.sock = new zmq[node.intype === 'sub' ? 'Subscriber' : 'Pull']();
        node.connected = false;
    
        await initSocketConnection(node);
    
        if (node.intype === "sub") {
            node.sock.subscribe(node.topic);
        }
    
        for await (const msg of node.sock) {
            let p = {};
            let parts = [msg];
    
            for (let i = 0; i < parts.length; i++) {
                p[node.fields[i]] = processMessagePart(node, parts[i], i);
            }
            node.send(p);
        }
    }
  
    function ZmqInNode(n) {
        RED.nodes.createNode(this, n);
        this.server = n.server;
        this.isserver = n.isserver;
        this.intype = n.intype || "sub";
        this.topic = n.topic;
        this.fields = n.fields.split(",").map(function(f) { return f.trim(); });
        if (this.fields.length === 0) { this.fields = ["part0"]; }
        if (this.fields[0] === '') { this.fields = ["part0"]; }
        this.output = n.output;
        let node = this;

        initZmqInNode(node);

        node.on("close", function() {
            node.connected = false;
            node.sock.close();
            node.status({});
        });
    }
    RED.nodes.registerType("zeromq in", ZmqInNode);


    async function initZmqOutNode(node) {
        node.sock = new zmq[node.intype === 'pub' ? 'Publisher' : 'Push']();
        node.connected = false;
    
        try {
            if (node.isserver === true) {
                await node.sock.bind(node.server);
            } else {
                node.sock.connect(node.server);
            }
            node.status({ fill: "green", shape: "dot", text: "connected" });
            node.connected = true;
        } catch (e) {
            node.status({ fill: "red", shape: "ring", text: e.toString() });
            node.error(e);
        }
    }
    
    function ZmqOutNode(n) {
        RED.nodes.createNode(this, n);
        this.server = n.server;
        this.isserver = n.isserver;
        this.intype = n.intype || "pub";
        this.topic = n.topic;
        this.fields = n.fields.split(",").map(function(f) { return f.trim(); }) || [];
        let node = this;
    
        initZmqOutNode(node);
    
        node.on("input", async function(msg) {
            if (node.connected) {
                msg.topic = node.topic || msg.topic;
                if (typeof msg.payload === "object" && !Buffer.isBuffer(msg.payload)) {
                    msg.payload = JSON.stringify(msg.payload);
                }
                const m = [];
                for (const field of node.fields) {
                    m.push(msg[field]);
                }
                await node.sock.send(m);
            } else {
                node.error("Not connected: " + node.server, msg);
            }
        });
        
    
        node.on("close", function() {
            node.connected = false;
            node.sock.close();
            node.status({});
        });
    }
    RED.nodes.registerType("zeromq out", ZmqOutNode);

    async function initZmqInOutNode(node) {
        node.sock = new zmq.Pair();
        node.connected = false;
    
        try {
            if (node.isserver === true) {
                await node.sock.bind(node.server);
            } else {
                node.sock.connect(node.server);
            }
            node.status({ fill: "green", shape: "dot", text: "connected" });
            node.connected = true;
        } catch (e) {
            node.status({ fill: "red", shape: "ring", text: e.toString() });
            node.error(e);
        }
    }
    function processInputMessage(node, msg) {
        msg.topic = node.topic || msg.topic;
    
        if (typeof msg.payload === "object" && !Buffer.isBuffer(msg.payload)) {
            msg.payload = JSON.stringify(msg.payload);
        }
    
        const m = node.fields.map(field => msg[field]);
        return m;
    }
    async function handleMessage(node, message) {
        const p = {};
    
        for (let i = 0; i < message.length; i++) {
            if (i >= node.fields.length) {
                node.fields[i] = "part" + i;
            }
            p[node.fields[i]] = message[i];
    
            if (node.output !== "buffer") {
                try {
                    p[node.fields[i]] = message[i].toString();
                } catch (e) {
                    p.error = true;
                    node.error("Not a string", p);
                }
            }
    
            if (node.output === "json") {
                try {
                    p[node.fields[i]] = JSON.parse(p[node.fields[i]]);
                } catch (e) {
                    p.error = true;
                    node.error("Failed to parse", p);
                }
            }
        }
        node.send(p);
    }
    
    function ZmqInOutNode(n) {
        RED.nodes.createNode(this, n);
        this.server = n.server;
        this.isserver = n.isserver;
        this.intype = n.intype || "pair";
        this.topic = n.topic;
        this.fields = n.fields.split(",").map(function (f) {
            return f.trim();
        }) || [];
        this.output = n.output;
        const node = this;
    
        initZmqInOutNode(node);
    
        node.on("input", async function (msg) {
            if (node.connected) {
                const m = processInputMessage(node, msg);
                await node.sock.send(m);
            } else {
                node.error("Not connected: " + node.server, msg);
            }
        });
    
        (async () => {
            for await (const message of node.sock) {
                await handleMessage(node, message);
            }
        })();
    
        node.on("close", function () {
            node.connected = false;
            node.sock.close();
            node.status({});
        });
    }
    RED.nodes.registerType("zeromq request", ZmqInOutNode);    
}
