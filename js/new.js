const network = require("./networking.js")
const crypto = require("node:crypto")

async function createNewDomain(domain, endpoint, nonce) {
    let seqNumber = "0"
    let index = global.domains.findIndex(
        item => item[0] === domain
    )

    if (index !== -1) {
        let oDomain = global.domains[index]
        seqNumber = (BigInt(oDomain[4]) + 1n).toString()
    }

    let data = domain +"|"+ endpoint +"|"+ seqNumber

    let signature = crypto.sign(null, Buffer.from(data), global.privateKey).toString("hex")


    await fetch(`http://127.0.0.1:${network.getPort()}/domain`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            domain: [domain, global.publicKey, nonce, endpoint, seqNumber, signature]
        })
    })
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