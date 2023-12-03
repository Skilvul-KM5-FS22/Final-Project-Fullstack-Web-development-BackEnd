const Video = require("../models/video");
const Buku = require("../models/buku");
const Uang = require("../models/midtrans");
const Donasi = require("../models/donasi");
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const cloudinary = require("../utils/cloudinary");
// const upload = require("../utils/multer");
const mongoose = require("mongoose");
const cron = require("node-cron");
const midtransClient = require("midtrans-client");

const createTransactionParameters = (orderId, amount, fullName, email, phone) => {
  return {
    transaction_details: {
      order_id: orderId,
      gross_amount: amount,
    },
    credit_card: {
      secure: true,
    },
    customer_details: {
      first_name: fullName,
      email,
      phone,
    },
  };
};

const generateOrderId = (userId) => {
  let today = new Date();
  let dd = String(today.getDate()).padStart(2, "0");
  let mm = String(today.getMonth() + 1).padStart(2, "0");
  let yyyy = today.getFullYear();
  let hours = String(today.getHours()).padStart(2, "0");
  let minutes = String(today.getMinutes()).padStart(2, "0");
  let seconds = String(today.getSeconds()).padStart(2, "0");

  return `${dd}${mm}${yyyy}${hours}${minutes}${seconds}${userId.slice(-4)}`;
};

const scheduleCronJob = async (savedUang) => {
  try {
    const cronJob = cron.schedule("*/30 * * * * *", async () => {
      console.log("Cron job is running...");
      try {
        const updatedTransactionStatus = await getTransactionStatusFromMidtrans(savedUang.order_id);
        console.log("Updated transaction status from Midtrans:", updatedTransactionStatus);

        savedUang.transaction_status = updatedTransactionStatus.transaction_status;
        savedUang.previous_transaction_id = savedUang.transaction_id;
        savedUang.transaction_id = updatedTransactionStatus.transaction_id;
        let now = new Date();
        savedUang.last_updated_at = now.toLocaleString("id-ID", {
          timeZone: "Asia/Jakarta",
          hour12: false,
        });

        await savedUang.save();

        console.log(`Transaction status updated: ${savedUang.transaction_status}`);

        // Stop the cron job if the transaction is complete
        if (updatedTransactionStatus.transaction_status === 'capture' || updatedTransactionStatus.transaction_status === 'settlement') {
          cronJob.stop();
          console.log('Transaction is complete, stopping cron job.');
        }
      } catch (transactionError) {
        console.error("Error updating transaction status:", transactionError.message);
      }
    });
  } catch (cronError) {
    console.error("Error scheduling cron job:", cronError.message);
  }
};

// Controller untuk mendapatkan status transaksi dari Midtrans
const getTransactionStatusFromMidtrans = async (order_id) => {
  let core = new midtransClient.CoreApi({
    isProduction: false,
    serverKey: process.env.SERVER_KEY,
  });

  try {
    const transactionStatus = await core.transaction.status(order_id);
    return transactionStatus;
  } catch (error) {
    console.error("Error getting transaction status from Midtrans:", error.message);
    throw error;
  }
};

module.exports = {
  donasiVideo: async (req, res) => {
    try {
      const { id } = req.params;

      if (!req.file) {
        return res.status(400).json({ error: "No file or video uploaded" });
      }

      const result = await cloudinary.uploader
        .upload_stream({ resource_type: "auto" }, async (error, result) => {
          if (error) {
            console.error(error);
            return res.status(500).json({ error: "Internal Server Error" });
          }

          try {
            // Get URL thumbnail from result
            const thumbnailUrl = cloudinary.url(result.public_id, {
              resource_type: "video",
              width: 300,
              height: 200,
              crop: "fill",
              format: "jpg",
            });

            const video = new Video({
              title: req.body.title,
              description: req.body.description,
              author: req.body.author,
              category: req.body.category,
              url_thumbnail: thumbnailUrl,
              url_video: result.secure_url,
              url_unduh: result.secure_url,
              tanggal_upload: new Date(),
            });

            const savedVideo = await video.save();

            // Create a new donation record for the video
            const donasi = new Donasi({
              videoID: savedVideo._id,
              userID: id,
            });

            const savedDonasi = await donasi.save();

            // Update the video record with the donation ID
            savedVideo.donaturId = savedDonasi._id;
            await savedVideo.save();

            res.json(savedVideo);
          } catch (updateError) {
            console.error(updateError);
            res.status(500).json({ error: "Internal Server Error" });
          }
        })
        .end(req.file.buffer);
    } catch (error) {
      console.log(error);
      res.status(500).send(error.message);
    }
  },

  donasiBuku: async (req, res) => {
    const { id } = req.params;

    try {
      const publicBucketUrl = process.env.R2_PUBLIC_BUCKET_URL;

      // Initialize S3 client
      const s3Client = new S3Client({
        region: "auto",
        endpoint: process.env.R2_ENDPOINT,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });

      // Generate random keys for book and image
      const bookKey = Math.round(Math.random() * 99999999999999).toString();
      const imgKey = Math.round(Math.random() * 99999999999999).toString();

      // Promises for book and image uploads
      const uploadBookPromise = s3Client.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: bookKey,
        Body: req.files.book_url[0].buffer,
        ContentType: req.files.book_url[0].mimetype,
      }));

      const uploadImgPromise = s3Client.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: imgKey,
        Body: req.files.img_url[0].buffer,
        ContentType: req.files.img_url[0].mimetype,
      }));

      // Wait for both uploads to complete
      const [bookUploadResult, imgUploadResult] = await Promise.all([
        uploadBookPromise,
        uploadImgPromise,
      ]);

      const bookUrl = publicBucketUrl + bookKey;
      const imgUrl = publicBucketUrl + imgKey;

      // Create a new book instance
      let buku = new Buku({
        title: req.body.title,
        description: req.body.description,
        author: req.body.author,
        tahun_terbit: req.body.tahun_terbit,
        rating: req.body.rating,
        star: req.body.star,
        img_url: imgUrl,
        book_url: bookUrl,
        download_url: bookUrl,
        category: req.body.category,
      });

      // Save the book instance
      const savedBuku = await buku.save();

      // Create a new donation instance
      const donasi = new Donasi({
        bookID: savedBuku._id,
        userID: id,
      });

      // Save the donation instance
      const savedDonasi = await donasi.save();

      // Update the donaturId in the saved book instance
      savedBuku.donaturId = savedDonasi._id;
      await savedBuku.save();

      // Respond with success message and data
      res.json({
        message: "Book donation successful",
        data: buku,
      });
    } catch (error) {
      console.error(error);
      // Respond with an error message and data
      res.json({
        message: "Book donation failed",
        data: error,
      });
    }
  },
  

  donasiUang: async (req, res) => {
    try {
      const { id } = req.params;
      const { full_name, email, phone, donation_amount, note } = req.body;

      if (!full_name || !email || !phone || !donation_amount) {
        return res.status(400).json({
          success: false,
          message: "Terdapat kolom yang kosong dalam permintaan.",
        });
      }

      const orderId = generateOrderId(id);

      let snap = new midtransClient.Snap({
        isProduction: false,
        serverKey: process.env.SERVER_KEY,
      });

      let parameter = createTransactionParameters(orderId, donation_amount, full_name, email, phone);

      const transaction = await snap.createTransaction(parameter);

      const uang = new Uang({
        order_id: parameter.transaction_details.order_id,
        full_name,
        email,
        phone,
        donation_amount,
        note,
        transaction_id: transaction.transaction_id,
        transaction_status: "Butuh update",
        donaturId: id,
      });

      const savedUang = await uang.save();

      console.log("Berhasil menyimpan data donasi uang:", savedUang);

      const donasi = new Donasi({
        uangID: savedUang._id,
        userID: id,
      });

      const savedDonasi = await donasi.save();

      console.log("Transaction ID:", transaction.transaction_id);

      console.log("Before scheduling cron job...");
      await scheduleCronJob(savedUang);

      res.status(201).json({
        success: true,
        message: "Berhasil melakukan charge transaksi!",
        data: transaction,
      });
    } catch (error) {
      console.error("Error in donasiUang:", error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  getTransactionStatus: async (req, res) => {
    try {
      const { order_id } = req.params;

      if (!order_id) {
        return res.status(400).json({
          success: false,
          message: "No order_id in the request.",
        });
      }

      const transactionStatus = await getTransactionStatusFromMidtrans(order_id);

      res.status(200).json({
        success: true,
        message: "Transaction status retrieved successfully!",
        data: transactionStatus,
      });
    } catch (error) {
      console.error("Error in getTransactionStatus:", error.message);
      res.status(500).json({ success: false, message: error.message });
    }
  },

  totalDonasiByUser: async (req, res) => {
    try {
      const { id } = req.params;

      const result = await Donasi.aggregate([
        {
          $match: {
            userID: mongoose.Types.ObjectId.createFromHexString(id),
          },
        },
        {
          $group: {
            _id: "$userID",
            total_donasi: { $sum: 1 },
          },
        },
      ]).exec();

      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).send(error.message);
    }
  },

  totalDonasiVideo: async (req, res) => {
    try {
      const result = await Donasi.aggregate([
        {
          $match: {
            videoID: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: null,
            total_donasi_video: { $sum: 1 },
          },
        },
      ]).exec();

      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).send(error.message);
    }
  },
  totalDonasiBuku: async (req, res) => {
    try {
      const result = await Donasi.aggregate([
        {
          $match: {
            bookID: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: null,
            total_donasi_book: { $sum: 1 },
          },
        },
      ]).exec();

      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).send(error.message);
    }
  },

  totalDonasiUang: async (req, res) => {
    try {
      const result = await Donasi.aggregate([
        {
          $match: {
            uangID: { $exists: true, $ne: null },
          },
        },
        {
          $lookup: {
            from: "transactions", // Ganti dengan nama koleksi transactions sesuai nama koleksi di database Anda
            localField: "uangID",
            foreignField: "_id",
            as: "transactionData",
          },
        },
        {
          $unwind: "$transactionData", // Memisahkan dokumen yang digabungkan
        },
        {
          $group: {
            _id: null,
            total_nominal_donasi_uang: {
              $sum: "$transactionData.donation_amount",
            },
          },
        },
      ]).exec();

      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).send(error.message);
    }
  },
};
