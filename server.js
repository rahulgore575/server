const express = require("express");
const cors = require("cors");
const axios = require("axios");
const bodyParser = require("body-parser");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// Environment Variables
const API_KEY = process.env.API_KEY; // For backend authentication
const GET_API_BASE_URL = process.env.GET_API_BASE_URL; // For inventory fetch
const POST_API_BASE_URL = process.env.POST_API_BASE_URL; // For ADF POST
const CLIENT_KEYS = process.env.ALLOWED_CLIENT_KEYS?.split(',').map(k => k.trim()) || [];
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [];

// Middleware: CORS with origin check
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'x-client-key']
}));

// Middleware: Body parsing
app.use(express.json());
app.use(bodyParser.text({ type: "application/xml" }));

// Middleware: Client key validation
app.use((req, res, next) => {
  const clientKey = req.headers["x-client-key"];
  if (!clientKey || !CLIENT_KEYS.includes(clientKey)) {
    return res.status(403).json({ error: "Unauthorized request: Invalid or missing client key" });
  }
  next();
});

/**
 * GET /api/inventory/:uuid
 * Proxies a GET request using a dealership UUID to fetch inventory JSON
 */
app.get("/api/inventory/:uuid", async (req, res) => {
  const uuid = req.params.uuid;
  const presignedUrlEndpoint = `${GET_API_BASE_URL}/integration/iep/dealership_inventory/${uuid}`;

  try {
    // Get presigned URL by HEAD request
    const headResponse = await axios({
      method: 'head',
      url: presignedUrlEndpoint,
      headers: {
        Authorization: `Basic ${API_KEY}`,
        "Content-Type": "application/json"
      },
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status < 400
    });

    const presignedUrl = headResponse.headers['location'];
    if (!presignedUrl) {
      return res.status(404).json({ error: "Presigned URL not found." });
    }

    // Download JSON from presigned S3 URL
    const fileResponse = await axios.get(presignedUrl);
    res.json(fileResponse.data);
  } catch (error) {
    console.error("GET Error:", error.message);
    res.status(error.response?.status || 500).json({
      error: "Failed to fetch inventory data.",
      details: error.response?.data || error.message
    });
  }
});

/**
 * POST /api/post-data
 * Proxies a POST request with ADF XML payload
 */
app.post("/api/post-data", async (req, res) => {
  const xml = req.body;

  if (!xml || typeof xml !== "string" || xml.trim() === "") {
    return res.status(400).json({ error: "Invalid or missing ADF XML data." });
  }

  try {
    const response = await axios.post(POST_API_BASE_URL, xml, {
      headers: {
        "Content-Type": "application/xml",
        Accept: "application/xml"
      }
    });

    res.status(response.status).send(response.data);
  } catch (error) {
    console.error("POST Error:", error.message);
    res.status(error.response?.status || 500).json({
      error: "Failed to forward ADF XML.",
      details: error.response?.data || error.message
    });
  }
});

// Health Check
app.get("/", (req, res) => {
  res.send("Express Proxy Server is Running...");
});

app.listen(PORT, () => {
  console.log(`Proxy server running at http://localhost:${PORT}`);
});
