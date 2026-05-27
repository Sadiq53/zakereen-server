const { Redis } = require("ioredis")

const client = new Redis({
    maxRetriesPerRequest: null
})

module.exports = client