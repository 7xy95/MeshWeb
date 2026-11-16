const storage = require("./storage.js")
let lastSync = 0
const chars = ['a','b','c','d','e','f','g','h','i','j','k', 'l','m','n','o','p','q','r','s',
    't','u','v','w','x','y','z','-','.','1','2','3','4','5','6','7','8','9','0']

async function sync(start=[""], useSaved=true) {
    function getRandNode() {
        return global.allNodes[Math.floor(Math.random() * (global.allNodes.length))]
    }
    async function getDomains(node, start) {
        // let controller = new AbortController()
        // let timer = setTimeout(() => controller.abort(), 3000)
        // try {
        //     let u = node + `domains?chars=[""]`
        //     let response = await fetch(u, {
        //         method: "GET",
        //         headers: {"Content-Type": "application/json"},
        //         signal: controller.signal
        //     })
        //     if (!response.ok) {
        //         return [false, true]
        //     }
        //
        //     response = await response.json()
        //     return [true, response.domains]
        // }
        // catch (error) {
        //     return [false, false]
        // }
        // finally {
        //     clearTimeout(timer)
        // }
        let result = await require("./networking").get(node, `domains?chars=` + encodeURIComponent(JSON.stringify([start])), 3, true)
        if (result === null) {return [false, false]}
        if (result === 422) {return [false, true]}
        if (typeof result === "number") {return [false, false]}
        return [true, result.domains]
    }
    async function addDomains(start) {
        let node = getRandNode()
        let domainData = await getDomains(node, start)
        if (domainData[0]) {
            for (let domain of domainData[1]) {
                global.newDomain(domain)
            }
            return [true, []]
        }
        else if (!domainData[0] && domainData[1]) {
            let l = []
            for (let char of chars) {
                l.push(start + char)
            }
            return [true, l]
        }
        else {
            return [false, []]
        }
    }

    if (useSaved) {global.domains = storage.getDomains()}

    if (global.allNodes.length === 0) {
        return
    }

    lastSync = Date.now()
    let left = start
    let fails = 0
    while (left.length !== 0) {
        let response = await addDomains(left[0])
        if (response[0]) {
            left.shift()
            left.push(...response[1])
            fails = 0
        }
        else {
            fails++
            if (fails > 5) {
                left = left.slice(1)
                fails = 0
            }
        }
    }
    if (useSaved) {storage.saveDomains()}
}
function getLastSync() {
    return lastSync
}
function updateLastSync() {
    lastSync = Date.now()
}

module.exports = {
    sync,
    getLastSync,
    updateLastSync
}