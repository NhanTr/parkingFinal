const mongoose = require("mongoose");

const cardSchema = new mongoose.Schema({
    cardNumber: { type: String, required: true, unique: true },
    entryTime: { type: Date, default: null },
    exitTime: { type: Date, default: null }
});

module.exports = mongoose.model("Card", cardSchema);
