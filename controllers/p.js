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
        console.log(
          "Updated transaction status from Midtrans:",
          updatedTransactionStatus
        );

        savedUang.transaction_status =
          updatedTransactionStatus.transaction_status;
        savedUang.previous_transaction_id = savedUang.transaction_id;
        savedUang.transaction_id = updatedTransactionStatus.transaction_id;
        // tambahkan detail metode pembayaran
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
        });

        await savedUang.save();

        console.log(
          `Transaction status updated: ${savedUang.transaction_status}`
        );

        // Save Donasi document only if the transaction is complete
        if (
          updatedTransactionStatus.transaction_status === "capture" ||
          updatedTransactionStatus.transaction_status === "settlement"
        ) {
          console.log("Transaction is complete, saving Donasi document...");

          // Update the transaction_status to "Success"
          savedUang.transaction_status = "Success";
          await savedUang.save();

          console.log(
            `Transaction status updated to "Success": ${savedUang.transaction_status}`
          );

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
    // tambahkan detail metode pembayaran
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

module.exports = {
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
};
