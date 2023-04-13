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

test.before('Connect to MongoDB', async (t) => {
  // This will create an new instance of "MongoMemoryServer" and automatically start it
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 2 } }) // This will create an ReplSet with 2 members

  const uri = replSet.getUri()
  await mongoose.connect(uri)
  await mongoose.connection.db.dropDatabase()
  const client = await MongoClient.connect(uri)
  client.db('test')
})

test.serial('Build the /test/skip endpoints', async (t) => {
  // Create the schema.
  const SkipSchema = new mongoose.Schema({
    title: String
  })

  // Create the model.
  const SkipModel = mongoose.model('skip', SkipSchema)

  // Create the REST resource and continue.
  const skipResource = Resource(app, '/test', 'skip', SkipModel)
    .rest({
      before: async (ctx: Koa.Context, next: Koa.Next) => {
        ctx.state.skipResource = true
        return await next()
      }
    })
    .virtual({
      path: 'resource',
      before: async (ctx: Koa.Context, next: Koa.Next) => {
        ctx.state.skipResource = true
        return await next()
      }
    })

  const { default: skipSwaggerio } = await import('./OpenAPI/skip.json', {
    assert: { type: 'json' }
  })

  const swaggerio = skipResource.swagger()
  t.is(Object.values(swaggerio).length, 4)
  t.truthy(swaggerio.info)
  t.truthy(swaggerio.paths)
  t.is(swaggerio.openapi, '3.1')
  t.truthy(swaggerio.components)
  t.truthy(swaggerio.components?.schemas)
  t.truthy(swaggerio.components?.schemas?.skip)
  t.is((swaggerio.components?.schemas?.skip as OpenAPIV3.SchemaObject).title, 'skip')
  t.is(Object.values(swaggerio.paths).length, 3)
  t.deepEqual(swaggerio, skipSwaggerio)
})

test('Test skipResource: /GET empty list', async (t) => await request(server)
  .get('/test/skip')
  .expect('Content-Type', /text\/plain/)
  .expect(404)
  .then((res) => {
    t.is(res.text, 'Not Found')
  }))

test('Test skipResource: /POST Create new resource', async (t) => await request(server)
  .post('/test/skip')
  .send({
    title: 'Test1',
    description: '12345678'
  })
  .expect('Content-Type', /text\/plain/)
  .expect(404)
  .then((res) => {
    t.is(res.text, 'Not Found')
  }))

test('Test skipResource: /GET The new resource', async (t) => await request(server)
  .get('/test/skip/undefined')
  .expect('Content-Type', /text\/plain/)
  .expect(404)
  .then((res) => {
    t.is(res.text, 'Not Found')
  }))

test('Test skipResource: /PUT Change data on the resource', async (t) => await request(server)
  .put('/test/skip/undefined')
  .send({
    title: 'Test2'
  })
  .expect('Content-Type', /text\/plain/)
  .expect(404)
  .then((res) => {
    t.is(res.text, 'Not Found')
  }))

test('Test skipResource: /PATCH Change data on the resource', async (t) => await request(server)
  .patch('/test/skip/undefined')
  .expect('Content-Type', /text\/plain/)
  .expect(404)
  .then((res) => {
    t.is(res.text, 'Not Found')
  }))

test('Test skipResource: /DELETE the resource', async (t) => await request(server)
  .delete('/test/skip/undefined')
  .expect('Content-Type', /text\/plain/)
  .expect(404)
  .then((res) => {
    t.is(res.text, 'Not Found')
  }))

test('Test skipResource: /VIRTUAL the resource', async (t) => await request(server)
  .get('/test/skip/virtual/resource')
  .expect('Content-Type', /text\/plain/)
  .expect(404)
  .then((res) => {
    t.is(res.text, 'Not Found')
  }))

test.after.always('cleanup', async (t) => {
  await replSet.stop()
})
