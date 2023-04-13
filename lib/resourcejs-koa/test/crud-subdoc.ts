import test from 'ava'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import mongoose from 'mongoose'
import ResourceJS from '../resource.js'
import { MongoClient, ObjectId, type Db, type WithId, type Document } from 'mongodb'
import { type OpenAPIV3 } from 'openapi-types'
import request from 'supertest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

const app = new Koa()
const server = app.listen()

// Use the body parser.
app.use(bodyParser())

interface ResourceItem {
  _id: string | ObjectId
  title?: string
  age?: number
  married?: boolean
  updated?: Date
  description?: string
  list?: any[]
}

let resource: ResourceItem
let doc1: ResourceItem
let doc2: ResourceItem

let replSet: MongoMemoryReplSet

let db: Db

test.serial.before('Connect to MongoDB', async (t) => {
  // This will create an new instance of "MongoMemoryServer" and automatically start it
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 2 } }) // This will create an ReplSet with 2 members
  const uri = replSet.getUri()
  await mongoose.connect(uri)
  await mongoose.connection.db.dropDatabase()
  const client = await MongoClient.connect(uri)
  db = client.db('test')
})

test.serial('Build the /test/ref endpoints', async (t) => {
  // Create the schema.
  const RefSchema = new mongoose.Schema({
    data: String
  }, { collection: 'ref' })

  // Create the model.
  const RefModel = mongoose.model('ref', RefSchema)

  // Create the REST resource and continue.
  const test = ResourceJS(app, '/test', 'ref', RefModel).rest()
  const { default: testSwaggerio } = await import('./OpenAPI/ref.json', {
    assert: { type: 'json' }
  })
  const swaggerio = test.swagger()
  t.is(Object.values(swaggerio).length, 4)
  t.truthy(swaggerio.info)
  t.truthy(swaggerio.paths)
  t.is(swaggerio.openapi, '3.1')
  t.truthy(swaggerio.components)
  t.truthy(swaggerio.components?.schemas)
  t.truthy(swaggerio.components?.schemas?.ref)
  t.is((swaggerio.components?.schemas?.ref as OpenAPIV3.SchemaObject)?.title, 'ref')
  t.is(Object.values(swaggerio.paths).length, 2)
  t.deepEqual(swaggerio, testSwaggerio)
})

test.serial('Build the /test/resource1 endpoints', async (t) => {
  // Create the schema.
  const R1SubdocumentSchema = new mongoose.Schema({
    label: {
      type: String
    },
    data: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ref'
    }]
  }, { _id: false })

  const Resource1Schema = new mongoose.Schema({
    title: {
      type: String,
      required: true
    },
    name: {
      type: String
    },
    age: {
      type: Number
    },
    description: {
      type: String
    },
    list: [R1SubdocumentSchema],
    list2: [String]
  })

  // Create the model.
  const Resource1Model = mongoose.model('resource1', Resource1Schema)

  // Create the REST resource and continue.
  const resource1 = ResourceJS(app, '/test', 'resource1', Resource1Model).rest({
    async afterDelete (ctx: Koa.Context, next: Koa.Next) {
      // Check that the delete item is still being returned via resourcejs.
      t.not(ctx.state.resource.item, {})
      t.not(ctx.state.resource.item, [])
      t.is(ctx.state.resource.status, 204)
      t.is(ctx.status, 404) // In Koa the ctx status is changed in respond
      return await next()
    }
  })

  const { default: resource1Swaggerio } = await import('./OpenAPI/resource1.json', {
    assert: { type: 'json' }
  })
  const swaggerio = resource1.swagger()
  t.is(Object.values(swaggerio).length, 4)
  t.truthy(swaggerio.info)
  t.truthy(swaggerio.paths)
  t.is(swaggerio.openapi, '3.1')
  t.truthy(swaggerio.components)
  t.truthy(swaggerio.components?.schemas)
  t.truthy(swaggerio.components?.schemas?.resource1)
  t.is((swaggerio.components?.schemas?.resource1 as OpenAPIV3.SchemaObject).title, 'resource1')
  t.is(Object.values(swaggerio.paths).length, 2)
  t.deepEqual(swaggerio, resource1Swaggerio)
})

test.serial('Test single resource subdocument updates - Bootsrap: Should create a reference doc with mongoose', async (t) => {
  const doc = { data: 'test1' }

  await request(server)
    .post('/test/ref')
    .send(doc)
    .expect('Content-Type', /json/)
    .expect(201)
    .then((res) => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { __v, ...response } = res.body
      t.is(response.data, doc.data)
      doc1 = response
    })
})

test.serial('Test single resource subdocument updates - Bootsrap: Should be able to create a reference doc directly with mongo', async (t) => {
  const doc = { data: 'test2' }
  const compare = JSON.parse(JSON.stringify(doc))

  const ref = db.collection('ref')
  const inserted = await ref.insertOne(doc)
  const response = await ref.findOne(inserted.insertedId)
  t.truthy(response)
  const { _id, ...comp } = response as WithId<Document>
  t.deepEqual(comp, compare)

  doc2 = JSON.parse(JSON.stringify(response as WithId<Document>))
})

test.serial('Test single resource subdocument updates - Bootsrap: Should be able to directly create a resource with subdocuments using mongo', async (t) => {
  // Set the resource collection for direct mongo queries.
  const resource1 = db.collection('resource1')

  const tmp = {
    title: 'Test2',
    description: '987654321',
    list: [
      { label: 'one', data: [doc1._id] }
    ]
  }
  const compare = Object.assign({}, tmp)
  const inserted = await resource1.insertOne(tmp)
  const result = (await resource1.findOne({ _id: inserted.insertedId }) as WithId<Document>)
  const { _id, ...comp } = result
  resource = result
  t.deepEqual(comp, compare)
})

test.serial('Test single resource subdocument updates - Subdocument Tests: /PUT to a resource with subdocuments should not mangle the subdocuments', async (t) => {
  const two = { label: 'two', data: [doc2._id.toString()] }

  await request(server)
    .put(`/test/resource1/${resource._id.toString()}`)
    .send({ list: resource.list?.concat(two) })
    .expect('Content-Type', /json/)
    .expect(200)
    .then((res) => {
      const response = res.body
      t.is(response.title, resource.title)
      t.is(response.description, resource.description)
      t.is(response._id, resource._id.toString())
      t.deepEqual(response.list, resource.list?.concat(two))
      resource = response
    })
})

test.serial('Test single resource subdocument updates - Subdocument Tests: Manual DB updates to a resource with subdocuments should not mangle the subdocuments', async (t) => {
  const updates = [
    { label: '1', data: [doc1._id] },
    { label: '2', data: [doc2._id] },
    { label: '3', data: [doc1._id, doc2._id] }
  ]

  const resource1 = db.collection('resource1')
  await resource1.updateOne(
    { _id: new ObjectId(resource._id) },
    { $set: { list: updates } }
  )

  const response = await resource1.findOne({ _id: new ObjectId(resource._id) }) as WithId<Document>
  t.is(response.title, resource.title ?? '')
  t.is(response.description, resource.description)
  t.is(response._id.toString(), resource._id.toString())
  t.deepEqual(response.list, updates)
  resource = JSON.parse(JSON.stringify(response))
})

test.serial('Test single resource subdocument updates - Subdocument Tests: /PUT to a resource subdocument should not mangle the subdocuments', async (t) => {
  // Update a subdocument property.
  const update = Array.from(resource.list ?? [])
  await request(server)
    .put(`/test/resource1/${resource._id.toString()}`)
    .send({ list: update })
    .expect('Content-Type', /json/)
    .expect(200)
    .then((res) => {
      const response = res.body
      t.is(response.title, resource.title)
      t.is(response.description, resource.description)
      t.is(response._id, resource._id)
      t.deepEqual(response.list, update)
      resource = response
    })
})

test.serial('Test single resource subdocument updates - Subdocument Tests: /PUT to a top-level property should not mangle the other collection properties', async (t) => {
  const tempTitle = 'an update without docs'

  await request(server)
    .put(`/test/resource1/${resource._id.toString()}`)
    .send({ title: tempTitle })
    .expect('Content-Type', /json/)
    .expect(200)
    .then((res) => {
      const response = res.body
      t.is(response.title, tempTitle)
      t.is(response.description, resource.description)
      t.is(response._id, resource._id)
      t.deepEqual(response.list, resource.list)
      resource = response
    })
})

// Remove the test resource.
test.serial.after('Subdocument cleanup: Should remove the test resource', async (t) => {
  const resource1 = db.collection('resource1')
  await resource1.deleteOne({ _id: new ObjectId(resource._id) })
})

test.serial.after('Subdocument cleanup: Should remove the test ref resources', async (t) => {
  const ref = db.collection('ref')
  await Promise.all([ref.deleteOne({ _id: new ObjectId(doc1._id) }), ref.deleteOne({ _id: new ObjectId(doc2._id) })])
})

test.serial.after.always('cleanup', async (t) => {
  await replSet.stop()
})
