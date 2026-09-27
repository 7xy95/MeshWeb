const { contextBridge, ipcRenderer } = require("electron")

function allow() {
    return location.protocol === "file:" && location.pathname.includes("/mainPage/")
}

contextBridge.exposeInMainWorld("mesh", {
    run: code => {
        if (!allow()) {return}
        ipcRenderer.send("main:run", code)
    },
    get: code => {
        if (!allow()) {return}
        return ipcRenderer.invoke("main:get", code)
    },
    setUrl: url => {
        if (!allow()) {return}
        console.log("preload setUrl:", url)
        return ipcRenderer.sendToHost("ui:setUrl", url)
    }
})