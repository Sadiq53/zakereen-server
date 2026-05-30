const mongoose = require('mongoose');

const vocalSessionSchema = new mongoose.Schema({
  title: { 
    type: String, 
    required: [true, 'Title is required'],
    trim: true 
  },
  description: { 
    type: String, 
    required: [true, 'Description is required'],
    trim: true 
  },
  instructions: [{ 
    type: String,
    trim: true
  }],
  sequence: [{ 
    type: String, 
    required: [true, 'Sequence notes are required'],
    trim: true
  }],
  order: { 
    type: Number, 
    default: 0 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  }
}, { timestamps: true });

module.exports = mongoose.model('VocalSession', vocalSessionSchema);
