import test from 'ava'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import mongoose from 'mongoose'
import Resource from '../resource.js'
import { MongoClient } from 'mongodb'
import { type OpenAPIV3 } from 'openapi-types'
import request from 'supertest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

const app = new Koa()
const server = app.listen()

// Use the body parser.
app.use(bodyParser())

// The raw connection to mongo, for consistency checks with mongoose.
let replSet: MongoMemoryReplSet

test.serial.before('Connect to MongoDB', async (t) => {
  // This will create an new instance of "MongoMemoryServer" and automatically start it
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 2 } }) // This will create an ReplSet with 2 members

  const uri = replSet.getUri()
  await mongoose.connect(uri)
  await mongoose.connection.db.dropDatabase()
  const client = await MongoClient.connect(uri)
  client.db('test')
})

test.serial.before('Build the /test/resource4 endpoints', async (t) => {
  // Create the schema.
  const Resource4Schema = new mongoose.Schema({
    title: String,
    writeOption: String
  })

  // Create the model.
  const Resource4Model = mongoose.model('resource4', Resource4Schema)

  const doc = new Resource4Model({ title: 'Foo' })
  await doc.save()

  // Create the REST resource and continue.
  const resource4 = Resource(app, '/test', 'resource4', Resource4Model)
    .rest({
      async beforePatch (ctx: Koa.Context, next: Koa.Next) {
        ctx.state.modelQuery = {
          findOne: async function findOne () {
            throw new Error('failed')
          }
        }
        return await next()
      }
    })
    .virtual({
      path: 'undefined_query',
      before: async function (ctx: Koa.Context, next: Koa.Next) {
        ctx.state.modelQuery = undefined
        return await next()
      }
    })
    .virtual({
      path: 'defined',
      before: async function (ctx: Koa.Context, next: Koa.Next) {
        ctx.state.modelQuery = Resource4Model.aggregate([
          { $group: { _id: null, titles: { $sum: '$title' } } }
        ])
        return await next()
      }
    })
    .virtual({
      path: 'error',
      before: async function (ctx: Koa.Context, next: Koa.Next) {
        ctx.state.modelQuery = {
          exec: async function exec () {
            throw new Error('Failed')
          }
        }
        return await next()
      }
    })
    .virtual({
      path: 'empty',
      before: async function (ctx: Koa.Context, next: Koa.Next) {
        ctx.state.modelQuery = {
          exec: async function exec () {

          }
        }
        return await next()
      }
    })
  const { default: resource4Swaggerio } = await import('./OpenAPI/resource4.json', {
    assert: { type: 'json' }
  })
  const swaggerio = resource4.swagger()
  t.is(Object.values(swaggerio).length, 4)
  t.truthy(swaggerio.info)
  t.truthy(swaggerio.paths)
  t.is(swaggerio.openapi, '3.1')
  t.truthy(swaggerio.components)
  t.truthy(swaggerio.components?.schemas)
  t.truthy(swaggerio.components?.schemas?.resource4)
  t.is((swaggerio.components?.schemas?.resource4 as OpenAPIV3.SchemaObject).title, 'resource4')
  t.is(Object.values(swaggerio.paths).length, 6)
  t.deepEqual(swaggerio, resource4Swaggerio)
})

test('Test Errors: /VIRTUAL undefined resource query', async (t) => await request(server)
  .get('/test/resource4/virtual/undefined_query')
  .expect('Content-Type', /json/)
  .expect(404)
  .then((res) => {
    t.is(res.body.errors[0], 'Resource not found')
  }))

test('Test Errors: /VIRTUAL resource query', async (t) => await request(server)
  .get('/test/resource4/virtual/defined')
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response[0]._id, null)
    t.is(response[0].titles, 0)
  }))

test('Test Errors: /VIRTUAL errorous resource query', async (t) => await request(server)
  .get('/test/resource4/virtual/error')
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    const response = res.body
    t.is(response.message, 'Failed')
  }))

test('Test Errors: /VIRTUAL empty resource response', async (t) => await request(server)
  .get('/test/resource4/virtual/empty')
  .expect('Content-Type', /json/)
  .expect(404)
  .then((res) => {
    const response = res.body
    t.is(response.errors[0], 'Resource not found')
  }))

test('Test Errors: /PATCH with errorous modelquery', async (t) => await request(server)
  .patch('/test/resource4/1234')
  .expect('Content-Type', /json/)
  .expect(400)
  .then((res) => {
    const response = res.body
    t.is(response.message, 'failed')
  }))
