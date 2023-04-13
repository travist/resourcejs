import test from 'ava'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import mongoose from 'mongoose'
import ResourceJS from '../resource.js'
import { MongoClient } from 'mongodb'
import { type OpenAPIV3 } from 'openapi-types'
import request from 'supertest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

const app = new Koa()
const server = app.listen()

// Use the body parser.
app.use(bodyParser())

let resource: {
  _id: string
  title?: string
  writeOption?: string
}

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

test.before('Build the /test/resource3 endpoints', async (t) => {
  // Create the schema.
  const Resource3Schema = new mongoose.Schema({
    title: String,
    writeOption: String
  })

  Resource3Schema.pre('save', function (next, options) {
    if ((options as { writeSetting: boolean } & mongoose.SaveOptions)?.writeSetting) {
      next(); return
    }

    next(new Error('Save options not passed to middleware'))
  })
  // @ts-expect-error This kind of pre-hook should exist...
  Resource3Schema.pre('remove', function (next, options) {
    if ((options as { writeSetting: boolean } & mongoose.SaveOptions)?.writeSetting) {
      return next()
    }

    return next(new Error('DeleteOptions not passed to middleware'))
  })

  // Create the model.
  const Resource3Model = mongoose.model('resource3', Resource3Schema)

  // Create the REST resource and continue.
  const resource3 = ResourceJS(app, '/test', 'resource3', Resource3Model).rest({
    async before (ctx: Koa.Context, next: Koa.Next) {
      // This setting should be passed down to the underlying `save()` command
      ctx.state.writeOptions = { writeSetting: true }

      return await next()
    }
  })
  const { default: resource3Swaggerio } = await import('./OpenAPI/resource3.json', {
    assert: { type: 'json' }
  })
  const swaggerio = resource3.swagger()
  t.is(Object.values(swaggerio).length, 4)
  t.truthy(swaggerio.info)
  t.truthy(swaggerio.paths)
  t.is(swaggerio.openapi, '3.1')
  t.truthy(swaggerio.components)
  t.truthy(swaggerio.components?.schemas)
  t.truthy(swaggerio.components?.schemas?.resource3)
  t.is((swaggerio.components?.schemas?.resource3 as OpenAPIV3.SchemaObject).title, 'resource3')
  t.is(Object.values(swaggerio.paths).length, 2)
  t.deepEqual(swaggerio, resource3Swaggerio)
})

test.serial('Test writeOptions capabilities: /POST a new resource3 with options', async (t) => await request(server)
  .post('/test/resource3')
  .send({ title: 'Test1' })
  .expect('Content-Type', /json/)
  .expect(201)
  .then((res) => {
    const response = res.body
    t.is(response.title, 'Test1')
    t.true(Object.hasOwn(response, '_id'), 'The response must contain the mongo object `_id`')
    resource = response
  }))

test('Test writeOptions capabilities: /PUT an update with options', async (t) => await request(server)
  .put(`/test/resource3/${resource._id}`)
  .send({ title: 'Test1 - Updated' })
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.title, 'Test1 - Updated')
    t.true(Object.hasOwn(response, '_id'), 'Resource ID not found')
  }))

test('Test writeOptions capabilities: /PATCH an update with options', async (t) => await request(server)
  .patch(`/test/resource3/${resource._id}`)
  .send([{ op: 'replace', path: '/title', value: 'Test1 - Updated Again' }])
  .expect('Content-Type', /json/)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.is(response.title, 'Test1 - Updated Again')
    t.true(Object.hasOwn(response, '_id'), 'Resource ID not found')
  }))

test.serial.after('Test writeOptions capabilities: /DELETE a resource3 with options', async (t) => await request(server)
  .delete(`/test/resource3/${resource._id}`)
  .expect(200)
  .then((res) => {
    const response = res.body
    t.deepEqual(response, {})
  }))

test.serial.after.always('cleanup', async (t) => {
  await replSet.stop()
})
