const Video = require("../models/video");
const Buku = require("../models/buku");
const Uang = require("../models/midtrans");
const Donasi = require("../models/donasi");
const R2 = require("aws-sdk");
const cloudinary = require("../utils/cloudinary");
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
      const cronJob = cron.schedule("*/30 * * * *", async () => {
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
  
  // Controller to get transaction status from Midtrans
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
};