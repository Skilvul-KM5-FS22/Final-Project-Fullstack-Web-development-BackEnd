const express = require("express");
const {
  donasiVideo,
  donasiBuku,
  donasiUang,
  totalDonasiByUser,
  totalDonasiVideoByUser,
  totalDonasiBukuByUser,
  totalDonasiUangByUser,
  totalDonasiVideo,
  totalDonasiBuku,
  totalDonasiUang,
  topDonasiVideoUsers,
  topDonasiBukuUsers,
  topDonasiUangUsers,
  topAllDonasiUsers,
} = require("../controllers/donasi.controllers");
const upload = require("../utils/multer");
const route = express.Router();

route.use(function (req, res, next) {
  try {
    res.header(
      "Access-Control-Allow-Headers",
      "x-access-token, Origin, Content-Type, Accept, Authorization"
    );
    next();
  } catch (error) {
    console.error("Error in middleware:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


// Rute untuk donasi video
route.post("/donasivideo/:id", upload.single("file"), donasiVideo);

// Rute untuk donasi buku
route.post(
  "/donasibuku/:id",
  upload.fields([
    { name: "img_url", maxCount: 1 },
    { name: "book_url", maxCount: 1 },
  ]),
  (req, res) => {
    // Memeriksa apakah file berhasil diunggah sebelum menyimpan atau memprosesnya
    try {
      if (!req.files || !req.files.img_url || !req.files.book_url) {
        return res.status(400).json({ error: "Some files are missing" });
      }
      donasiBuku(req, res);
    } catch (error) {
      console.error("Error in donasiBuku route:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

route.post("/donasiuang/:id", async (req, res) => {
  try {
    await donasiUang(req, res);
  } catch (error) {
    console.error("Error in /donasiuang/:id route:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// Rute untuk total donasi by user
route.get("/total-donasi/:id", totalDonasiByUser);
route.get("/total-donasi-videos/:id", totalDonasiVideoByUser);
route.get("/total-donasi-buku/:id", totalDonasiBukuByUser);
route.get("/total-donasi-uang/:id", totalDonasiUangByUser);
route.get("/all-donasi-videos", totalDonasiVideo);
route.get("/all-donasi-buku", totalDonasiBuku);
route.get("/all-donasi-uang", totalDonasiUang);
route.get("/top-donasi-videos", topDonasiVideoUsers);
route.get("/top-donasi-buku", topDonasiBukuUsers);
route.get("/top-donasi-uang", topDonasiUangUsers);
route.get("/top-all-donasi", topAllDonasiUsers);

module.exports = route;
