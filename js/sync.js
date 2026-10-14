const storage = require("./storage.js")

async function sync(amount=3, useSaved=true) {
    async function reqRandNode() {
        try {
            let node = global.allNodes[Math.floor(Math.random() * (global.allNodes.length))]
            let data = await require("./networking.js").get(node, "domains")
            return data.domains
        } catch (error) {
            return null
        }
    }

    if (useSaved) {global.domains = storage.getDomains()}

    if (global.allNodes.length === 0) {
        return
    }

    let f = 0
    for (let i = 0; i < amount; i++) {
        let d = await reqRandNode()
        if (d === null) {
            if (f<10) {
                i--
            }
            f++
            continue
        }
        for (let domain of d) {
            global.newDomain(domain)
        }
    }
    if (useSaved) {storage.saveDomains()}
}

module.exports = {
    sync
}