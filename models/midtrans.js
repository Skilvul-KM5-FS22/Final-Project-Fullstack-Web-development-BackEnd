const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
  order_id: {
    type: String,  
    required: true,
  },
  donaturId: {
    type: mongoose.ObjectId,
    ref: "Donasi",
  },
  full_name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
  },
  phone: {
    type: String,
  },
  donation_amount: {
    type: Number,
    required: true,
  },
  note: {
    type: String,
  },
  payment_type: {
    type: String,
  },
  bank: {
    type: String,
  },
  va_numbers: [{
    type: Object,
  }],
  store: {
    type: String,
  },
  issuer: {
    type: String,
  },
  acquirer: {
    type: String,
  },
  response_midtrans: {
    type: String,
  },
  transaction_status: {
    type: String,
  },
  previous_transaction_id: {
    type: String,
  },
  created_at: {
    type: String,
  },
  success_at: {
    type: String,
  },
  last_updated_at: {
    type: String,
    default: () => new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }),
  },
});

module.exports = mongoose.model("Transaction", transactionSchema);