const network = require("./networking.js")
const crypto = require("node:crypto")

async function createNewDomain(domain, endpoint, nonce) {
    let seqNumber = "0"
    let index = global.domains.findIndex(
        item => item[0] === domain
    )

    if (index !== -1) {
        let oDomain = global.domains[index]
        if (oDomain[1] === global.publicKey) {
            seqNumber = (BigInt(oDomain[4]) + 1n).toString()
        }
    }

    let data = domain +"|"+ endpoint +"|"+ seqNumber

    let signature = crypto.sign(null, Buffer.from(data), global.privateKey).toString("hex")

    let d = [domain, global.publicKey, nonce, endpoint, seqNumber, signature]
    if (global.newDomain(d)) {
        void network.broadcastDomain(d, 25)
    }
}
function newKeys(s) {
    s = crypto.createHash("sha256").update(s).digest()

    let privateDer = Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"), s
    ])

    global.privateKey = crypto.createPrivateKey({
        key: privateDer, format: "der", type: "pkcs8"
    })

    global.publicKey = crypto.createPublicKey(global.privateKey).export({type: "spki", format: "pem"})
}
function getPubKey(s) {
    s = crypto.createHash("sha256").update(s).digest()

    let privateDer = Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"), s
    ])

    let privateKey = crypto.createPrivateKey({
        key: privateDer, format: "der", type: "pkcs8"
    })

    return crypto.createPublicKey(privateKey).export({type: "spki", format: "pem"})
}
function updateDomain(domain, endpoint, seed) {
    try {
        newKeys(seed)

        let nonce = global.domains.find(item => item[0] === domain)[2]

        if (!nonce) {return}

        void createNewDomain(domain, endpoint, nonce)
    }
    catch {}
}

global.createNewDomain = createNewDomain
global.newKeys = newKeys
global.updateDomain = updateDomain
global.getPubKey = getPubKey