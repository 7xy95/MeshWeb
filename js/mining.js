const gpuMiner = require("./gpuMiner")

let stop = false
let best = 0
let domainTo = null
let endpointTo = null
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
        console.log(Date.now()-t, result.attempts)
    }
}
function stopMining() {
    stop = true
    domainTo = null
    endpointTo = null
    best = 0n
}
function getBest() {
    return {"best": best, "domain": domainTo, "endpoint": endpointTo, "target": global.getDomainDifficulty(domainTo)}
}

global.mine = mine
global.stopMining = stopMining
global.getBest = getBest