'use strict'

const http = require('http')
const https = require('https')
const net = require('net')
const SocksProxyAgent = require('socks-proxy-agent')
const { SocksClient } = require('socks')

/**
 * @typedef {object} TinyProxyOptions
 * @property {string} proxyType - 'socks', 'http'
 * @property {?number} socksType - null, 4, 5
 * @property {string} proxyAuth - basic auth
 * @property {string} proxyURL
 * @property {string} proxyHost
 * @property {string} proxyPort
 * @property {string} proxyUsername
 * @property {string} proxyPassword
 */

class TinyProxyChain {
  /**
   * @param {object} params
   * @param {number} params.listenPort
   * @param {string} [params.proxyURL] - 'socks://127.0.0.1:8081'
   * @param {string} [params.proxyUsername]
   * @param {string} [params.proxyPassword]
   * @param {number} [params.debug=0]
   * @param {Function} [params.onRequest]
   * @param {string} [params.key] - ssl key
   * @param {string} [params.cert] - ssl cert
   * @param {string} [params.ca] - ssl cert
   * @param {?number} [params.connectionTimeout] - close inactive socket
   */
  constructor ({
    listenPort,
    proxyURL,
    proxyUsername,
    proxyPassword,
    debug = 0,
    onRequest,
    key,
    cert,
    ca,
    connectionTimeout = null
  }) {
    /** @type {number} */
    this.listenPort = listenPort

    /** @type {?TinyProxyOptions} */
    this.defaultProxyOptions = TinyProxyChain.makeProxyOptions(proxyURL, proxyUsername, proxyPassword)

    /** @type {number} */
    this.debug = typeof debug === 'number' ? debug : debug ? 3 : 0

    /** @type {Function} */
    this.onRequest = onRequest || ((req, opt) => opt)

    /** @type {?number} */
    this.connectionTimeout = connectionTimeout

    /** @type {http.Server} */
    this.proxy = key && cert && ca
      ? https.createServer({ key, cert, ca }, (req, res) => this.makeRequest(req, res))
      : http.createServer((req, res) => this.makeRequest(req, res))

    this.proxy.on('connect', this.makeConnection.bind(this))
    this.proxy.on('error', e => console.log(e))

    if (this.debug > 0) {
      this.lastId = 0
      this.connections = new Map()
    }
  }

  /**
   * @param {string} proxyURL
   * @param {string} [proxyUsername]
   * @param {string} [proxyPassword]
   * @returns {?TinyProxyOptions}
   */
  static makeProxyOptions (proxyURL, proxyUsername, proxyPassword) {
    if (proxyURL) {
      const { hostname, port } = new URL(proxyURL)

      const proxyType = /^socks/.test(proxyURL) ? 'socks' : 'http'

      return hostname
        ? {
          proxyType,
          socksType: proxyType === 'socks' ? /^socks5?:/.test(proxyURL) ? 5 : 4 : null,
          proxyAuth: proxyUsername && proxyPassword ? TinyProxyChain.makeAuth(proxyUsername, proxyPassword) : '',
          proxyURL: proxyURL,
          proxyHost: hostname,
          proxyPort: port,
          proxyUsername,
          proxyPassword
        }
        : null
    }

    return null
  }

  /**
   * @param {string} proxyUsername
   * @param {string} proxyPassword
   * @returns {string}
   */
  static makeAuth (proxyUsername, proxyPassword) {
    return 'Basic ' + Buffer.from(`${proxyUsername}:${proxyPassword}`).toString('base64')
  }

  /**
   * @returns {TinyProxyChain}
   */
  listen () {
    if (!this.proxy.listening) {
      this.proxy.listen(this.listenPort)

      if (this.debug > 0) {
        console.log(`TCP server accepting connection on port: ${this.listenPort}`)
      }
    }

    return this
  }

  /**
   * @returns {TinyProxyChain}
   */
  close () {
    if (this.proxy.listening) {
      this.proxy.close()
    }

    return this
  }

  /**
   * @param {TinyProxyOptions} proxyOptions
   * @param {http.IncomingMessage} req
   * @returns {{hostname: string, port: string, path: string, method: string, headers: object, agent: SocksProxyAgent}}
   */
  static makeSocksRequestOptions (proxyOptions, req) {
    const { hostname, port, pathname } = new URL(req.url)
    const headers = { ...req.headers }

    delete headers['Proxy-Authorization']

    return {
      hostname,
      port,
      path: pathname,
      method: req.method,
      headers,
      agent: new SocksProxyAgent(proxyOptions.proxyURL)
    }
  }

  /**
   * @param {TinyProxyOptions} proxyOptions
   * @param {http.IncomingMessage} req
   * @returns {{hostname: string, port: string, path: string, method: string, headers: object}}
   */
  static makeHttpRequestOptions (proxyOptions, req) {
    return {
      hostname: proxyOptions.proxyHost,
      port: proxyOptions.proxyPort,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        'Proxy-Authorization': proxyOptions.proxyAuth
      }
    }
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  makeRequest (req, res) {
    const proxyOptions = this.onRequest(req, this.defaultProxyOptions)

    if (!proxyOptions) {
      res.end()
    } else {
      const options = proxyOptions.proxyType === 'socks'
        ? TinyProxyChain.makeSocksRequestOptions(proxyOptions, req)
        : TinyProxyChain.makeHttpRequestOptions(proxyOptions, req)

      const proxyReq = http.request(options)

      req.pipe(proxyReq)

      proxyReq.once('response', proxyRes => {
        res.statusCode = proxyRes.statusCode

        Object.keys(proxyRes.headers).forEach(key => {
          res.setHeader(key, proxyRes.headers[key])
        })

        proxyRes.pipe(res)
      })

      proxyReq.once('error', e => {
        res.statusCode = 500
        res.end()

        if (this.debug > 2) {
          console.error('<-', e)
        }
      })
    }
  }

  /**
   * @param {object} proxyOptions
   * @param {http.IncomingMessage} req
   * @param {stream.Duplex} clientSocket
   * @returns {Promise<net.Socket>}
   */
  async makeSocksConnection (proxyOptions, req, clientSocket) {
    const [host, port] = req.url.split(':')

    const options = {
      proxy: {
        host: proxyOptions.proxyHost,
        port: parseInt(proxyOptions.proxyPort),
        type: proxyOptions.socksType, // 4 or 5
        userId: proxyOptions.proxyUsername,
        password: proxyOptions.proxyPassword
      },

      command: 'connect',

      destination: {
        host,
        port: parseInt(port) || 80
      }
    }

    const { socket: srvSocket } = await SocksClient.createConnection(options)

    srvSocket.once('end', () => {
      if (clientSocket.writable) {
        clientSocket.end()
      }
    })

    srvSocket.once('error', e => {
      if (clientSocket.writable) {
        clientSocket.write(`HTTP/${req.httpVersion} 500 Connection error\r\n\r\n`)
        clientSocket.end()
      }

      if (this.debug > 2) {
        console.error('<-', e)
      }
    })

    if (clientSocket.writable) {
      clientSocket.write('HTTP/1.0 200 Connection established\r\n\r\n')
    }

    return srvSocket
  }

  /**
   * @param {object} proxyOptions
   * @param {http.IncomingMessage} req
   * @param {stream.Duplex} clientSocket
   * @returns {Promise<net.Socket>}
   */
  async makeHTTPProxyConnection (proxyOptions, req, clientSocket) {
    return new Promise(resolve => {
      const srvSocket = net.connect(proxyOptions.proxyPort, proxyOptions.proxyHost, () => {
        const httpRequest = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
          Object.keys(req.headers).map(header => `${header}: ${req.headers[header]}\r\n`).join('') +
          `Proxy-Authorization: ${proxyOptions.proxyAuth}\r\n\r\n`

        if (this.debug > 2) {
          console.log(`\n${httpRequest}\n`)
        }

        srvSocket.write(httpRequest)

        resolve(srvSocket)
      })

      srvSocket.once('end', () => {
        clientSocket.end()
      })

      srvSocket.once('error', e => {
        clientSocket.write(`HTTP/${req.httpVersion} 500 Connection error\r\n\r\n`)
        clientSocket.end()

        if (this.debug > 2) {
          console.error('<-', e)
        }
      })
    })
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {stream.Duplex} clientSocket
   * @param {Buffer} head
   * @returns {Promise}
   */
  async makeConnection (req, clientSocket, head) {
    let srvSocket = null
    let alive = true

    if (this.connectionTimeout) {
      clientSocket.setTimeout(this.connectionTimeout)
      clientSocket.once('timeout', () => {
        if (this.debug > 1) {
          console.log(`Stream timeout ${req.url}`)
        }

        clientSocket.end()
      })
    }

    clientSocket.once('error', e => {
      alive = false

      if (srvSocket) {
        srvSocket.end()
      }

      if (this.debug > 2) {
        console.error('->', e)
      }
    })

    if (this.debug > 0) {
      const id = this.lastId++

      this.addReq(id, req)
      clientSocket.once('close', () => this.rmReq(id))
    }

    const proxyOptions = this.onRequest(req, this.defaultProxyOptions)

    if (!proxyOptions) {
      clientSocket.end()
    } else {
      try {
        srvSocket = await (proxyOptions.proxyType === 'socks'
          ? this.makeSocksConnection(proxyOptions, req, clientSocket)
          : this.makeHTTPProxyConnection(proxyOptions, req, clientSocket))

        srvSocket.once('close', () => {
          if (!clientSocket.destroyed) {
            clientSocket.end()
          }
        })

        if (head && head.length > 0) {
          srvSocket.write(head)
        }

        clientSocket.on('data', data => {
          if (srvSocket.writable) {
            srvSocket.write(data)
          }
        })

        srvSocket.pipe(clientSocket)

        if (!alive) {
          srvSocket.end()
        }
      } catch (e) {
        if (this.debug > 2) {
          console.error('<-1', e)
        }

        clientSocket.write(`HTTP/${req.httpVersion} 500 Connection error\r\n\r\n`)
        clientSocket.end()

        if (srvSocket) {
          srvSocket.end()
        }
      }
    }
  }

  /**
   * @param {number} id
   * @param {http.IncomingMessage} req
   */
  addReq (id, req) {
    if (this.debug > 1) {
      console.log(`#${id} ${req.method} ${req.url}`)
    }

    if (!this.connections.has(id)) {
      this.connections.set(id, { id, url: req.url })
    }

    console.log(`Connections: ${this.connections.size}`)
  }

  /**
   * @param {number} id
   */
  rmReq (id) {
    if (this.connections.has(id)) {
      if (this.debug > 1) {
        const data = this.connections.get(id)

        console.log(`#${id} closed ${data.url}`)
      }

      this.connections.delete(id)
    } else {
      console.error(`Already deleted #${id}`)
    }

    console.log(`Connections: ${this.connections.size}`)
  }
}

module.exports = TinyProxyChain
