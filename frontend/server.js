const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");

const dev = false; // ALWAYS false on Namecheap (Production only)

const port = process.env.PORT || 3000;
// Namecheap will inject the correct internal port automatically

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
    createServer((req, res) => {
        const parsedUrl = parse(req.url, true);
        handle(req, res, parsedUrl);
    }).listen(port, (err) => {
        if (err) throw err;
        console.log(`> Server running on port ${port}`);
    });
});
