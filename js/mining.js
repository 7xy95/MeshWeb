const gpuMiner = require("./gpuMiner")

let stop = false
let best = 0
let domainTo = null
let endpointTo = null
let lastT = null
async function mine(domain, endpoint) {
    domainTo = domain
    endpointTo = endpoint
    let i = require("crypto").randomBytes(8).readBigUInt64BE() % (18n * 10n**18n)
    best = global.getDomainDifficulty(domain)
    while (true) {
        if (stop) {stop = false; break}

        let t = Date.now()

        let result = await gpuMiner.mine(domain, global.publicKey, i)
        let hash = 256 - Math.log2(Number(BigInt("0x" + result.hash)))

        if (best < hash) {
            best = hash
            if (best > 31) {
                global.createNewDomain(domain, endpoint, result.nonce)
            }
        }

        i += 50_000_000n
        lastT = Date.now()-t
    }
}
function stopMining() {
    stop = true
    domainTo = null
    endpointTo = null
    best = 0n
}
function getData() {
    return {"best": best, "domain": domainTo, "endpoint": endpointTo, "lastT": lastT}
}

global.mine = mine
global.stopMining = stopMining
global.getData = getData