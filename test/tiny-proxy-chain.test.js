'use strict'
/* eslint-env mocha */

const assert = require('assert')
const fetch = require('node-fetch')
const { proxyURL, proxyUsername, proxyPassword } = require('../proxy-test.json')
const HttpsProxyAgent = require('https-proxy-agent')
const HttpProxyAgent = require('http-proxy-agent')
const TinyProxyChain = require('../index.js')

describe('Connection without proxy', () => {
  it(`http://example.com`, async () => {
    const res = await fetch('http://example.com')

    assert(res.status === 200)

    const txt = await res.text()

    assert(txt && txt.includes('Example Domain'))
  })

  it(`https://example.com`, async () => {
    const res = await fetch('https://example.com')

    assert(res.status === 200)

    const txt = await res.text()

    assert(txt && txt.includes('Example Domain'))
  })
})

describe('Connection via proxy', () => {
  const { hostname: host, port } = new URL(proxyURL)
  const headers = { 'Proxy-Authorization': 'Basic ' + Buffer.from(`${proxyUsername}:${proxyPassword}`).toString('base64') }

  it(`http://example.com`, async () => {
    const agent = new HttpProxyAgent({ host, port })
    const res = await fetch('http://example.com', { agent, headers })

    assert(res.status === 200, `Status: ${res.status}`)

    const txt = await res.text()

    assert(txt && txt.includes('Example Domain'))
  })

  it(`https://example.com`, async () => {
    const agent = new HttpsProxyAgent({ host, port, headers })
    const res = await fetch('https://example.com', { agent })

    assert(res.status === 200, `Status: ${res.status}`)

    const txt = await res.text()

    assert(txt && txt.includes('Example Domain'))
  })
})

describe('Connection via proxy chain', () => {
  const proxy = new TinyProxyChain({
    listenPort: 8080,
    proxyURL,
    proxyUsername,
    proxyPassword
  }).listen()

  it(`http://example.com`, async () => {
    const agent = new HttpProxyAgent('http://127.0.0.1:8080')
    const res = await fetch('http://example.com', { agent })

    assert(res.status === 200, `Status: ${res.status}`)

    const txt = await res.text()

    assert(txt && txt.includes('Example Domain'))
  })

  it(`https://example.com`, async () => {
    const agent = new HttpsProxyAgent('http://127.0.0.1:8080')
    const res = await fetch('https://example.com', { agent })

    assert(res.status === 200, `Status: ${res.status}`)

    const txt = await res.text()

    assert(txt && txt.includes('Example Domain'))
  })

  after(() => {
    proxy.close()
  })
})
