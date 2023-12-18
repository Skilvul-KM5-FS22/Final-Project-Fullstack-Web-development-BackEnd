const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  const htmlResponse = `
    <!DOCTYPE html>
    <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="refresh" content="5;url=https://literasikita.netlify.app/halaman-donasi/donasi-uang/payment"> <!-- Tambahkan baris ini -->
        <title>Donasi Berhasil</title>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            background-color: #f0f0f0;
            padding: 20px;
            box-sizing: border-box;
          }

          h1 {
            color: #4CAF50;
            text-align: center;
          }

          p {
            color: #333;
            text-align: center;
            max-width: 800px;
          }

          .emoji {
            font-size: 48px;
          }
        </style>
      </head>
      <body>
        <h1>Terima Kasih Atas Donasi Anda!</h1>
        <p class="emoji">🎉</p>
        <p>Kontribusi murah hati Anda akan menciptakan dampak yang luar biasa. Kami sangat menghargai dukungan Anda.</p>

        <script>
          setTimeout(() => {
            alert("Anda Akan segera diarahkan ke halaman sebelumnya");
          }, 3000);
        </script>
      </body>
    </html>
  `;
  res.send(htmlResponse);
});

module.exports = router;
