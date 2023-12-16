const Video = require("../models/video");
const Buku = require("../models/buku");
const Uang = require("../models/midtrans");
const Donasi = require("../models/donasi");
const Transaction = require("../models/midtrans");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const cloudinary = require("../utils/cloudinary");
// const upload = require("../utils/multer");
const mongoose = require("mongoose");
const cron = require("node-cron");
const midtransClient = require("midtrans-client");

const createTransactionParameters = (
  orderId,
  amount,
  fullName,
  email,
  phone
) => {
  let now = new Date();
  let createdTime = now.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour12: false,
  });

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
    item_details: [
      {
        id: orderId,
        price: amount,
        quantity: 1,
        name: "Donation",
      },
    ],
    custom_field1: "Donation Note",
    custom_field2: createdTime,
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

const scheduleCronJob = async (savedUang, userId) => {
  try {
    const cronJob = cron.schedule("*/10 * * * * *", async () => {
      console.log("Cron job is running...");
      try {
        const updatedTransactionStatus = await getTransactionStatusFromMidtrans(
          savedUang.order_id
        );

        savedUang.transaction_status =
          updatedTransactionStatus.transaction_status;
        savedUang.previous_transaction_id = savedUang.transaction_id;
        savedUang.transaction_id = updatedTransactionStatus.transaction_id;
        savedUang.payment_type = updatedTransactionStatus.payment_type;
        savedUang.bank = updatedTransactionStatus.bank;
        savedUang.va_numbers = updatedTransactionStatus.va_numbers;
        savedUang.store = updatedTransactionStatus.store;
        savedUang.issuer = updatedTransactionStatus.issuer;
        savedUang.acquirer = updatedTransactionStatus.acquirer;
        savedUang.gross_amount = updatedTransactionStatus.gross_amount;

        let now = new Date();
        savedUang.last_updated_at = now.toLocaleString("id-ID", {
          timeZone: "Asia/Jakarta",
          hour12: false,
          weekday: "short",
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        await savedUang.save();

        console.log(
          `Transaction status updated: ${savedUang.transaction_status}`
        );

        if (
          updatedTransactionStatus.transaction_status === "capture" ||
          updatedTransactionStatus.transaction_status === "settlement"
        ) {
          console.log("Transaction is complete, saving Donasi document...");

          savedUang.transaction_status = "Success";
          savedUang.success_at = now.toLocaleString("id-ID", {
            timeZone: "Asia/Jakarta",
            hour12: false,
            weekday: "short",
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });

          await savedUang.save();

          console.log(
            `Transaction status updated to "Success": ${savedUang.transaction_status}`
          );

          // Handle settlement details through your webhook endpoint
          // No direct synchronous method for fetching settlement details

          const donasi = new Donasi({
            uangID: savedUang._id,
            userID: userId,
          });

          const savedDonasi = await donasi.save();

          console.log("Donasi document saved:", savedDonasi);

          cronJob.stop();
          console.log("Cron job stopped.");
        }
      } catch (transactionError) {
        console.error(
          "Error updating transaction status:",
          transactionError.message
        );
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
    return {
      transaction_status: transactionStatus.transaction_status,
      transaction_id: transactionStatus.transaction_id,
      payment_type: transactionStatus.payment_type,
      bank: transactionStatus.bank ? transactionStatus.bank : null,
      va_numbers: transactionStatus.va_numbers
        ? transactionStatus.va_numbers
        : null,
      store: transactionStatus.store ? transactionStatus.store : null,
      issuer: transactionStatus.issuer ? transactionStatus.issuer : null,
      acquirer: transactionStatus.acquirer ? transactionStatus.acquirer : null,
      gross_amount: transactionStatus.gross_amount,
    };
  } catch (error) {
    console.error(
      "Error getting transaction status from Midtrans:",
      error.message
    );
    throw error;
  }
};

const getSettlementInfoFromMidtrans = async (transactionId) => {
  let core = new midtransClient.CoreApi({
    isProduction: false,
    serverKey: process.env.SERVER_KEY,
  });

  try {
    const settlementInfo = await core.transaction.settlement(transactionId);
    return settlementInfo;
  } catch (error) {
    console.error(
      "Error getting settlement information from Midtrans:",
      error.message
    );
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
      const uploadBookPromise = s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: bookKey,
          Body: req.files.book_url[0].buffer,
          ContentType: req.files.book_url[0].mimetype,
        })
      );

      const uploadImgPromise = s3Client.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: imgKey,
          Body: req.files.img_url[0].buffer,
          ContentType: req.files.img_url[0].mimetype,
        })
      );

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

      let parameter = createTransactionParameters(
        orderId,
        donation_amount,
        full_name,
        email,
        phone
      );

      const transaction = await snap.createTransaction(parameter);

      const now = new Date();

      const uang = new Uang({
        order_id: parameter.transaction_details.order_id,
        full_name,
        email,
        phone,
        donation_amount,
        note,
        transaction_id: transaction.transaction_id,
        transaction_status: "Pending",
        donaturId: id,
        created_at: now.toLocaleString("id-ID", {
          timeZone: "Asia/Jakarta",
          weekday: "short",
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      });

      const savedUang = await uang.save();

      console.log("Berhasil menyimpan data donasi uang:", savedUang);

      console.log("Before scheduling cron job...");
      await scheduleCronJob(savedUang, id); // Pass the user ID to scheduleCronJob

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

      const transactionStatus = await getTransactionStatusFromMidtrans(
        order_id
      );

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
            total_donasi_buku: {
              $sum: { $cond: [{ $gt: ["$bookID", null] }, 1, 0] },
            },
            total_donasi_video: {
              $sum: { $cond: [{ $gt: ["$videoID", null] }, 1, 0] },
            },
            total_donasi_uang: {
              $sum: { $cond: [{ $gt: ["$uangID", null] }, 1, 0] },
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

  totalDonasiVideoByUser: async (req, res) => {
    try {
      const { id } = req.params;

      const result = await Donasi.aggregate([
        {
          $match: {
            userID: mongoose.Types.ObjectId.createFromHexString(id),
            videoID: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: "$userID",
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

  totalDonasiBukuByUser: async (req, res) => {
    try {
      const { id } = req.params;

      const result = await Donasi.aggregate([
        {
          $match: {
            userID: mongoose.Types.ObjectId.createFromHexString(id),
            bookID: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: "$userID",
            total_donasi_buku: { $sum: 1 },
          },
        },
      ]).exec();

      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).send(error.message);
    }
  },

  totalDonasiUangByUser: async (req, res) => {
    try {
      const { id } = req.params;

      const result = await Donasi.aggregate([
        {
          $match: {
            userID: mongoose.Types.ObjectId.createFromHexString(id),
            uangID: { $exists: true, $ne: null },
          },
        },
        {
          $lookup: {
            from: "transactions",
            localField: "uangID",
            foreignField: "_id",
            as: "transactionData",
          },
        },
        {
          $unwind: "$transactionData",
        },
        {
          $group: {
            _id: "$userID",
            total_donasi_uang: {
              $sum: "$transactionData.donation_amount",
            },
            jumlah_donasi: { $sum: 1 },
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
            from: "transactions",
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

  topDonasiVideoUsers: async (req, res) => {
    try {
      const result = await Donasi.aggregate([
        {
          $match: {
            videoID: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: "$userID",
            total_donasi_video: { $sum: 1 },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "user_info",
          },
        },
        {
          $unwind: "$user_info",
        },
        {
          $project: {
            _id: 1,
            total_donasi_video: 1,
            nama: "$user_info.nama",
            profileImage: "$user_info.profileImage",
          },
        },
        {
          $sort: {
            total_donasi_video: -1,
          },
        },
        {
          $limit: 5,
        },
      ]).exec();

      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).send(error.message);
    }
  },

  topDonasiBukuUsers: async (req, res) => {
    try {
      const result = await Donasi.aggregate([
        {
          $match: {
            bookID: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: "$userID",
            total_donasi_buku: { $sum: 1 },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "user_info",
          },
        },
        {
          $unwind: "$user_info",
        },
        {
          $project: {
            _id: 1,
            total_donasi_buku: 1,
            nama: "$user_info.nama",
            profileImage: "$user_info.profileImage",
          },
        },
        {
          $sort: {
            total_donasi_buku: -1,
          },
        },
        {
          $limit: 5,
        },
      ]).exec();

      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).send(error.message);
    }
  },

  topDonasiUangUsers: async (req, res) => {
    try {
      const result = await Donasi.aggregate([
        {
          $match: {
            uangID: { $exists: true, $ne: null },
          },
        },
        {
          $lookup: {
            from: "transactions",
            localField: "uangID",
            foreignField: "_id",
            as: "transactionData",
          },
        },
        {
          $unwind: "$transactionData",
        },
        {
          $group: {
            _id: "$userID",
            total_donasi_uang: {
              $sum: "$transactionData.donation_amount",
            },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "user_info",
          },
        },
        {
          $unwind: "$user_info",
        },
        {
          $project: {
            _id: 1,
            total_donasi_uang: 1,
            nama: "$user_info.nama",
            profile_image: "$user_info.profileImage",
          },
        },
        {
          $sort: {
            total_donasi_uang: -1,
          },
        },
        {
          $limit: 5,
        },
      ]).exec();

      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).send(error.message);
    }
  },

  topAllDonasiUsers: async (req, res) => {
    try {
      const result = await Donasi.aggregate([
        {
          $group: {
            _id: "$userID",
            total_donasi: { $sum: 1 },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "user_info",
          },
        },
        {
          $unwind: "$user_info",
        },
        {
          $project: {
            _id: 1,
            total_donasi: 1,
            nama: "$user_info.nama",
            profileImage: "$user_info.profileImage",
          },
        },
        {
          $sort: {
            total_donasi: -1,
          },
        },
        {
          $limit: 5,
        },
      ]).exec();

      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).send(error.message);
    }
  },

  detailDonasiUang: async (req, res) => {
    try {
      const { id } = req.params;

      const details = await Transaction.aggregate([
        {
          $match: {
            donaturId: mongoose.Types.ObjectId.createFromHexString(id),
            // Add any additional conditions based on your requirements
          },
        },
        {
          $project: {
            orderId: "$order_id",
            nama: "$full_name",
            tanggal: { $ifNull: ["$success_at", "$created_at"]},
            nominal: "$donation_amount",
            status: "$transaction_status",
            metode_pembayaran: {
              $cond: {
                if: { $eq: ["$payment_type", "cstore"] },
                then: "$store",
                else: {
                  $cond: {
                    if: { $eq: ["$payment_type", "bank_transfer"] },
                    then: { $arrayElemAt: ["$va_numbers.bank", 0] },
                    else: {
                      $cond: {
                        if: { $eq: ["$payment_type", "qris"] },
                        then: {
                          $cond: {
                            if: { $ne: ["$issuer", null] },
                            then: "$issuer",
                            else: {
                              $cond: {
                                if: { $ne: ["$acquirer", null] },
                                then: "$acquirer",
                                else: "Unknown Acquirer",
                              },
                            },
                          },
                        },
                        else: {
                          $cond: {
                            if: { $eq: ["$payment_type", "gopay"] },
                            then: {
                              $cond: {
                                if: { $ne: ["$acquirer", null] },
                                then: "$acquirer",
                                else: "Unknown Acquirer",
                              },
                            },
                            else: "$payment_type",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            logo_metode_pembayaran: {
              $cond: {
                if: { $eq: ["$payment_type", "akulaku"] },
                then: `${process.env.BANK_LOGO}/akulaku_paylater.png`,
                else: {
                  $cond: {
                    if: { $eq: ["$store", "alfamart"] },
                    then: `${process.env.BANK_LOGO}/alfamart.png`,
                    else: {
                      $cond: {
                        if: { $eq: ["$store", "indomaret"] },
                        then: `${process.env.BANK_LOGO}/indomaret.png`,
                        else: {
                          $cond: {
                            if: { $eq: ["$payment_type", "qris"] },
                            then: {
                              $cond: {
                                if: { $eq: ["$issuer", "gopay"] },
                                then: `${process.env.BANK_LOGO}/gopay_landscape.png`,
                                else: {
                                  $cond: {
                                    if: { $eq: ["$issuer", "dana"] },
                                    then: `${process.env.BANK_LOGO}/Dana.png`,
                                    else: {
                                      $cond: {
                                        if: {
                                          $eq: ["$issuer", "airpay shopee"],
                                        },
                                        then: `${process.env.BANK_LOGO}/shopeepay_qris_1.png`,
                                        else: {
                                          $cond: {
                                            if: { $eq: ["$issuer", "ovo"] },
                                            then: `${process.env.BANK_LOGO}/OVO.png`,
                                            else: {
                                              $cond: {
                                                if: {
                                                  $eq: ["$issuer", "tcash"],
                                                },
                                                then: `${process.env.BANK_LOGO}/Tcash.png`,
                                                else: {
                                                  $cond: {
                                                    if: {
                                                      $eq: [
                                                        "$acquirer",
                                                        "airpay shopee",
                                                      ],
                                                    },
                                                    then: `${process.env.BANK_LOGO}/shopeepay.png`,
                                                    else: `${process.env.BANK_LOGO}/qris.png`,
                                                  },
                                                },
                                              },
                                            },
                                          },
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                            },
                            else: {
                              $cond: {
                                if: { $eq: ["$payment_type", "bank_transfer"] },
                                then: {
                                  $cond: {
                                    if: {
                                      $eq: [
                                        {
                                          $arrayElemAt: ["$va_numbers.bank", 0],
                                        },
                                        "bca",
                                      ],
                                    },
                                    then: `${process.env.BANK_LOGO}/bca.png`,
                                    else: {
                                      $cond: {
                                        if: {
                                          $eq: [
                                            {
                                              $arrayElemAt: [
                                                "$va_numbers.bank",
                                                0,
                                              ],
                                            },
                                            "bri",
                                          ],
                                        },
                                        then: `${process.env.BANK_LOGO}/bri.png`,
                                        else: {
                                          $cond: {
                                            if: {
                                              $eq: [
                                                {
                                                  $arrayElemAt: [
                                                    "$va_numbers.bank",
                                                    0,
                                                  ],
                                                },
                                                "bni",
                                              ],
                                            },
                                            then: `${process.env.BANK_LOGO}/bni.png`,
                                            else: {
                                              $cond: {
                                                if: {
                                                  $eq: [
                                                    {
                                                      $arrayElemAt: [
                                                        "$va_numbers.bank",
                                                        0,
                                                      ],
                                                    },
                                                    "permata",
                                                  ],
                                                },
                                                then: `${process.env.BANK_LOGO}/permata_bank.png`,
                                                else: {
                                                  $cond: {
                                                    if: {
                                                      $eq: [
                                                        {
                                                          $arrayElemAt: [
                                                            "$va_numbers.bank",
                                                            0,
                                                          ],
                                                        },
                                                        "cimb",
                                                      ],
                                                    },
                                                    then: `${process.env.BANK_LOGO}/cimbniaga.png`,
                                                    else: {
                                                      $cond: {
                                                        if: {
                                                          $eq: [
                                                            {
                                                              $arrayElemAt: [
                                                                "$va_numbers.bank",
                                                                0,
                                                              ],
                                                            },
                                                            "mandiri",
                                                          ],
                                                        },
                                                        then: `${process.env.BANK_LOGO}/mandiri.png`,
                                                        else: "URL_LOGO_DEFAULT",
                                                      },
                                                    },
                                                  },
                                                },
                                              },
                                            },
                                          },
                                        },
                                      },
                                    },
                                  },
                                },
                                else: {
                                  $cond: {
                                    if: {
                                      $eq: ["$payment_type", "credit_card"],
                                    },
                                    then: {
                                      $cond: {
                                        if: { $eq: ["$bank", "mega"] },
                                        then: `${process.env.BANK_LOGO}/bank_mega.png`,
                                        else: "URL_LOGO_DEFAULT",
                                      },
                                    },
                                    else: `${process.env.BANK_LOGO}/bank_transfer_network_atm_bersama.png`,
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        {
          $sort: {
            tanggal: -1, // Sort in descending order based on the tanggal field
          },
        },
      ]).exec();

      res.json(details);
    } catch (error) {
      console.error(error);
      res.status(500).send(error.message);
    }
  },
};
