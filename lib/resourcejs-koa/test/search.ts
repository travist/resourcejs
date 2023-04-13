import test from 'ava'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import mongoose from 'mongoose'
import ResourceJS from '../resource.js'
import { MongoClient } from 'mongodb'
import { type OpenAPIV3 } from 'openapi-types'
import request from 'supertest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { faker } from '@faker-js/faker'

const app = new Koa()
const server = app.listen()

// Use the body parser.
app.use(bodyParser())

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
interface ResourceItem {
  age: number
  name?: string
  title?: string
  description?: string
}
let refDoc1Content: { data: string }
let refDoc1Response: { _id: string, data: string }
let singleResource1Id: string
const resourceNames: string[] = []

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

test.serial('Build the /test/resource2 endpoints', async (t) => {
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

test.serial('Test single resource search capabilities: Should create a reference doc with mongoose', async (t) => {
  refDoc1Content = { data: 'test1' }
  const res = await request(server)
    .post('/test/ref')
    .send(refDoc1Content)
    .expect('Content-Type', /json/)
    .expect(201)
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const { __v, ...response } = res.body
  t.is(response.data, refDoc1Content.data)
  refDoc1Response = response
})

test.serial('Test single resource search capabilities: Create a full index of resources', async (t) => {
  for (const age of [...Array(25).keys()]) {
    const name = faker.name.fullName().toUpperCase()
    resourceNames.push(name)
    const res = await request(server)
      .post('/test/resource1')
      .send({
        title: `Test Age ${age}`,
        description: `Description of test age ${age}`,
        name,
        age
      })
    const response = res.body
    t.is(response.title, `Test Age ${age}`)
    t.is(response.description, `Description of test age ${age}`)
    t.is(response.age, age)
  }
  const refList = [{ label: '1', data: [refDoc1Response._id] }]

  // Insert a record with no age.
  const res = await request(server)
    .post('/test/resource1')
    .send({
      title: 'No Age',
      name: 'noage',
      description: 'No age',
      list: refList
    })
  const response = res.body
  t.is(response.title, 'No Age')
  t.is(response.description, 'No age')
  t.is(response.name, 'noage')
  t.true(!Object.hasOwn(response, 'age'), 'Age should not be found.')

  singleResource1Id = res.body._id
})

test('Test single resource search capabilitiesShould allow population on single object GET request', async (t) => await request(server)
  .get(`/test/resource1/${singleResource1Id}?populate=list.data`)
  .then((res) => {
    const response = res.body

    // Check statusCode
    t.is(res.statusCode, 200)

    // Check main resource
    t.is(response.title, 'No Age')
    t.is(response.description, 'No age')
    t.is(response.name, 'noage')
    t.is(response.list.length, 1)

    // Check populated resource
    t.is(response.list[0].label, '1')
    t.is(response.list[0].data.length, 1)
    t.is(response.list[0].data[0]._id, refDoc1Response._id)
    t.is(response.list[0].data[0].data, refDoc1Content.data)
  }))

test('Test single resource search capabilities: Create an aggregation path', async (t) => {
  const aggregation = ResourceJS(app, '', 'aggregation', mongoose.model('resource1')).rest({
    async beforeIndex (ctx: Koa.Context, next: Koa.Next) {
      ctx.state.modelQuery = mongoose.model('resource1')
      ctx.state.modelQuery.pipeline = []
      return await next()
    }
  })
  const swaggerio = aggregation.swagger()
  t.is(Object.values(swaggerio).length, 4)
  t.truthy(swaggerio.info)
  t.truthy(swaggerio.paths)
  t.is(swaggerio.openapi, '3.1')
  t.truthy(swaggerio.components)
  t.truthy(swaggerio.components?.schemas)
  t.truthy(swaggerio.components?.schemas?.aggregation)
  t.truthy(swaggerio.components?.schemas?.list)
  t.is((swaggerio.components?.schemas?.list as OpenAPIV3.SchemaObject).title, 'list')
  t.is((swaggerio.components?.schemas?.aggregation as OpenAPIV3.SchemaObject).title, 'aggregation')
  t.is(Object.values(swaggerio.paths).length, 2)
})

testSearch('/test/resource1', 'R1:')
testSearch('/aggregation', 'Agg:')

function testSearch (testPath: string, name: string): void {
  test(`${name} Should populate`, async (t) => await request(server)
    .get(`${testPath}?name=noage&populate=list.data`)
    .then((res) => {
      const response = res.body

      // Check statusCode
      t.is(res.statusCode, 200)

      // Check main resource
      t.is(response[0].title, 'No Age')
      t.is(response[0].description, 'No age')
      t.is(response[0].name, 'noage')
      t.is(response[0].list.length, 1)

      // Check populated resource
      t.is(response[0].list[0].label, '1')
      t.is(response[0].list[0].data.length, 1)
      t.is(response[0].list[0].data[0]._id, refDoc1Response._id)
      t.is(response[0].list[0].data[0].data, refDoc1Content.data)
    }))

  test(`${name} Should ignore empty populate query parameter`, async (t) => await request(server)
    .get(`${testPath}?name=noage&populate=`)
    .then((res) => {
      const response = res.body

      // Check statusCode
      t.is(res.statusCode, 200)

      // Check main resource
      t.is(response[0].title, 'No Age')
      t.is(response[0].description, 'No age')
      t.is(response[0].name, 'noage')
      t.is(response[0].list.length, 1)

      // Check populated resource
      t.is(response[0].list[0].label, '1')
      t.is(response[0].list[0].data.length, 1)
      t.is(response[0].list[0].data[0], refDoc1Response._id)
    }))

  test(`${name} Should not populate paths that are not a reference`, async (t) => await request(server)
    .get(`${testPath}?name=noage&populate=list2`)
    .then((res) => {
      const response = res.body

      // Check statusCode
      t.is(res.statusCode, 200)

      // Check main resource
      t.is(response[0].title, 'No Age')
      t.is(response[0].description, 'No age')
      t.is(response[0].name, 'noage')
      t.is(response[0].list.length, 1)

      // Check populated resource
      t.is(response[0].list[0].label, '1')
      t.is(response[0].list[0].data.length, 1)
      t.is(response[0].list[0].data[0], refDoc1Response._id)
    }))

  test(`${name} Should populate with options`, async (t) => await request(server)
    .get(`${testPath}?name=noage&populate[path]=list.data`)
    .expect(200)
    .then((res) => {
      const response = res.body

      // Check statusCode
      t.is(res.statusCode, 200)

      // Check main resource
      t.is(response[0].title, 'No Age')
      t.is(response[0].description, 'No age')
      t.is(response[0].name, 'noage')
      t.is(response[0].list.length, 1)

      // Check populated resource
      t.is(response[0].list[0].label, '1')
      t.is(response[0].list[0].data.length, 1)
      t.is(response[0].list[0].data[0]._id, refDoc1Response._id)
      t.is(response[0].list[0].data[0].data, refDoc1Content.data)
    }))

  test(`${name} Should limit 10`, async (t) => await request(server)
    .get(testPath)
    .expect('Content-Type', /json/)
    .expect(206)
    .then((res) => {
      const response = res.body
      t.is(response.length, 10)
      const ages = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
      response.forEach((resource: ResourceItem) => {
        const age = resource.age
        t.true(ages.has(age), 'Age out of bounds')
        t.is(resource.title, `Test Age ${age}`)
        t.is(resource.description, `Description of test age ${age}`)
        t.is(resource.age, age)
        ages.delete(age)
      })
    }))

  test(`${name} Should accept a change in limit`, async (t) => await request(server)
    .get(`${testPath}?limit=5`)
    .expect('Content-Type', /json/)
    .expect('Content-Range', '0-4/26')
    .expect(206)
    .then((res) => {
      const response = res.body
      t.is(response.length, 5)
      let age = 0
      response.forEach((resource: ResourceItem) => {
        t.is(resource.title, `Test Age ${age}`)
        t.is(resource.description, `Description of test age ${age}`)
        t.is(resource.age, age)
        age++
      })
    }))

  test(`${name} Should be able to skip and limit`, async (t) => await request(server)
    .get(`${testPath}?limit=5&skip=4`)
    .expect('Content-Type', /json/)
    .expect('Content-Range', '4-8/26')
    .expect(206)
    .then((res) => {
      const response = res.body
      t.is(response.length, 5)
      let age = 4
      response.forEach((resource: ResourceItem) => {
        t.is(resource.title, `Test Age ${age}`)
        t.is(resource.description, `Description of test age ${age}`)
        t.is(resource.age, age)
        age++
      })
    }))

  test(`${name} Should default negative limit to 10`, async (t) => await request(server)
    .get(`${testPath}?limit=-5&skip=4`)
    .expect('Content-Type', /json/)
    .expect('Content-Range', '4-13/26')
    .expect(206)
    .then((res) => {
      const response = res.body
      t.is(response.length, 10)
      let age = 4
      response.forEach((resource: ResourceItem) => {
        t.is(resource.title, `Test Age ${age}`)
        t.is(resource.description, `Description of test age ${age}`)
        t.is(resource.age, age)
        age++
      })
    }))

  test(`${name} Should default negative skip to 0`, async (t) => await request(server)
    .get(`${testPath}?limit=5&skip=-4`)
    .expect('Content-Type', /json/)
    .expect('Content-Range', '0-4/26')
    .expect(206)
    .then((res) => {
      const response = res.body
      t.is(response.length, 5)
      let age = 0
      response.forEach((resource: ResourceItem) => {
        t.is(resource.title, `Test Age ${age}`)
        t.is(resource.description, `Description of test age ${age}`)
        t.is(resource.age, age)
        age++
      })
    }))

  test(`${name} Should default negative skip and negative limit to 0 and 10`, async (t) => await request(server)
    .get(`${testPath}?limit=-5&skip=-4`)
    .expect('Content-Type', /json/)
    .expect('Content-Range', '0-9/26')
    .expect(206)
    .then((res) => {
      const response = res.body
      t.is(response.length, 10)
      let age = 0
      response.forEach((resource: ResourceItem) => {
        t.is(resource.title, `Test Age ${age}`)
        t.is(resource.description, `Description of test age ${age}`)
        t.is(resource.age, age)
        age++
      })
    }))

  test(`${name} Should default non numeric limit to 10`, async (t) => await request(server)
    .get(`${testPath}?limit=badlimit&skip=4`)
    .expect('Content-Type', /json/)
    .expect('Content-Range', '4-13/26')
    .expect(206)
    .then((res) => {
      const response = res.body
      t.is(response.length, 10)
      let age = 4
      response.forEach((resource: ResourceItem) => {
        t.is(resource.title, `Test Age ${age}`)
        t.is(resource.description, `Description of test age ${age}`)
        t.is(resource.age, age)
        age++
      })
    }))

  test(`${name} Should default non numeric skip to 0`, async (t) => await request(server)
    .get(`${testPath}?limit=5&skip=badskip`)
    .expect('Content-Type', /json/)
    .expect('Content-Range', '0-4/26')
    .expect(206)
    .then((res) => {
      const response = res.body
      t.is(response.length, 5)
      let age = 0
      response.forEach((resource: ResourceItem) => {
        t.is(resource.title, `Test Age ${age}`)
        t.is(resource.description, `Description of test age ${age}`)
        t.is(resource.age, age)
        age++
      })
    }))

  test(`${name} Should be able to select fields`, async (t) => await request(server)
    .get(`${testPath}?limit=10&skip=10&select=title,age`)
    .expect('Content-Type', /json/)
    .expect('Content-Range', '10-19/26')
    .expect(206)
    .then((res) => {
      const response = res.body
      t.is(response.length, 10)
      let age = 10
      response.forEach((resource: ResourceItem) => {
        t.is(resource.title, `Test Age ${age}`)
        t.is(resource.description, undefined)
        t.is(resource.age, age)
        age++
      })
    }))

  test(`${name} Should be able to select fields with multiple select queries`, async (t) => await request(server)
    .get(`${testPath}?limit=10&skip=10&select=title&select=age`)
    .expect('Content-Type', /json/)
    .expect('Content-Range', '10-19/26')
    .expect(206)
    .then((res) => {
      const response = res.body
      t.is(response.length, 10)
      let age = 10
      response.forEach((resource: ResourceItem) => {
        t.is(resource.title, `Test Age ${age}`)
        t.is(resource.description, undefined)
        t.is(resource.age, age)
        age++
      })
    }))

  test(`${name} Should be able to sort`, async (t) => await request(server)
    .get(`${testPath}?select=age&sort=-age`)
    .expect('Content-Type', /json/)
    .expect('Content-Range', '0-9/26')
    .expect(206)
    .then((res) => {
      const response = res.body
      t.is(response.length, 10)
      let age = 24
      response.forEach((resource: ResourceItem) => {
        t.is(resource.title, undefined)
        t.is(resource.description, undefined)
        t.is(resource.age, age)
        age--
      })
    }))

  test(`${name} Should paginate with a sort`, async (t) => await request(server)
    .get(`${testPath}?limit=5&skip=5&select=age&sort=-age`)
    .expect('Content-Type', /json/)
    .expect('Content-Range', '5-9/26')
    .expect(206)
    .then((res) => {
      const response = res.body
      t.is(response.length, 5)
      let age = 19
      response.forEach((resource: ResourceItem) => {
        t.is(resource.title, undefined)
        t.is(resource.description, undefined)
        t.is(resource.age, age)
        age--
      })
    }))

  test(`${name} Should be able to find`, async (t) => await request(server)
    .get(`${testPath}?limit=5&select=age&age=5`)
    .expect('Content-Type', /json/)
    .expect('Content-Range', '0-0/1')
    .expect(200)
    .then((res) => {
      const response = res.body
      t.is(response.length, 1)
      t.is(response[0].title, undefined)
      t.is(response[0].description, undefined)
      t.is(response[0].age, 5)
    }))

  test(`${name} eq search selector`, async (t) => await request(server)
    .get(`${testPath}?age__eq=5`)
    .expect('Content-Type', /json/)
    .expect(200)
    .then((res) => {
      const response = res.body
      t.is(response.length, 1)
      response.forEach((resource: ResourceItem) => {
        t.is(resource.age, 5)
      })
    }))

  test(`${name} equals (alternative) search selector`, async (t) => await request(server)
    .get(`${testPath}?age=5`)
    .expect('Content-Type', /json/)
    .expect(200)
    .then((res) => {
      const response = res.body
      t.is(response.length, 1)
      response.forEach((resource: ResourceItem) => {
        t.is(resource.age, 5)
      })
    }))

  test(`${name} ne search selector`, async (t) => await request(server)
    .get(`${testPath}?age__ne=5&limit=100`)
    .expect('Content-Type', /json/)
    .expect(200)
    .then((res) => {
      const response = res.body
      t.is(response.length, 25)
      response.forEach((resource: ResourceItem) => {
        t.not(resource.age, 5)
      })
    }))

  test(`${name} in search selector`, async (t) => await request(server)
    .get(`${testPath}?title__in=Test Age 1,Test Age 5,Test Age 9,Test Age 20`)
    .expect('Content-Type', /json/)
    .expect(200)
    .then((res) => {
      const response = res.body
      t.is(response.length, 4)
      response.forEach((resource: ResourceItem) => {
        let found = false;

        [1, 5, 9, 20].forEach((a) => {
          if (resource?.age === a) {
            found = true
          }
        })

        t.true(found)
      })
    }))

  test(`${name} nin search selector`, async (t) => await request(server)
    .get(`${testPath}?title__nin=Test Age 1,Test Age 5`)
    .expect('Content-Type', /json/)
    .expect(206)
    .then((res) => {
      const response = res.body
      t.is(response.length, 10)
      response.forEach((resource: ResourceItem) => {
        let found = false;

        [1, 5].forEach((a) => {
          if (resource?.age === a) {
            found = true
          }
        })

        t.true(!found)
      })
    }))

  test(`${name} exists=false search selector`, async (t) => await request(server)
    .get(`${testPath}?age__exists=false`)
    .expect('Content-Type', /json/)
    .expect(200)
    .then((res) => {
      const response = res.body
      t.is(response.length, 1)
      t.is(response[0].name, 'noage')
    }))

  test(`${name} exists=0 search selector`, async (t) => await request(server)
    .get(`${testPath}?age__exists=0`)
    .expect('Content-Type', /json/)
    .expect(200)
    .then((res) => {
      const response = res.body
      t.is(response.length, 1)
      t.is(response[0].name, 'noage')
    }))

  test(`${name} exists=true search selector`, async (t) => await request(server)
    .get(`${testPath}?age__exists=true&limit=1000`)
    .expect('Content-Type', /json/)
    .expect(200)
    .then((res) => {
      const response = res.body
      t.is(response.length, 25)
      response.forEach((resource: ResourceItem) => {
        t.true(resource.name !== 'noage', 'No age should be found.')
      })
    }))

  test(`${name} exists=1 search selector`, async (t) => await request(server)
    .get(`${testPath}?age__exists=true&limit=1000`)
    .expect('Content-Type', /json/)
    .expect(200)
    .then((res) => {
      const response = res.body
      t.is(response.length, 25)
      response.forEach((resource: ResourceItem) => {
        t.true(resource.name !== 'noage', 'No age should be found.')
      })
    }))

  test(`${name} lt search selector`, async (t) => await request(server)
    .get(`${testPath}?age__lt=5`)
    .expect('Content-Range', '0-4/5')
    .then((res) => {
      const response = res.body
      t.is(response.length, 5)
      response.forEach((resource: ResourceItem) => {
        t.truthy(resource.age < 5)
      })
    }))

  test(`${name} lte search selector`, async (t) => await request(server)
    .get(`${testPath}?age__lte=5`)
    .expect('Content-Range', '0-5/6')
    .then((res) => {
      const response = res.body
      t.is(response.length, 6)
      response.forEach((resource: ResourceItem) => {
        t.truthy(resource.age <= 5)
      })
    }))

  test(`${name} gt search selector`, async (t) => await request(server)
    .get(`${testPath}?age__gt=5`)
    .expect('Content-Range', '0-9/19')
    .then((res) => {
      const response = res.body
      t.is(response.length, 10)
      response.forEach((resource: ResourceItem) => {
        t.truthy(resource.age > 5)
      })
    }))

  test(`${name} gte search selector`, async (t) => await request(server)
    .get(`${testPath}?age__gte=5`)
    .expect('Content-Range', '0-9/20')
    .then((res) => {
      const response = res.body
      t.is(response.length, 10)
      response.forEach((resource: ResourceItem) => {
        t.truthy(resource.age >= 5)
      })
    }))

  test(`${name} regex search selector`, async (t) => await request(server)
    .get(`${testPath}?title__regex=/.*Age [0-1]?[0-3]$/g`)
    // .expect('Content-Range', '0-7/8')
    .then((res) => {
      const response = res.body
      const valid = [0, 1, 2, 3, 10, 11, 12, 13]
      t.is(response.length, valid.length)
      response.forEach((resource: ResourceItem) => {
        t.truthy(valid.includes(resource.age))
      })
    }))

  test(`${name} regex search selector should be case insensitive`, async (t) => {
    const name = resourceNames[0].toString()

    return await request(server)
      .get(`${testPath}?name__regex=${name.toUpperCase()}`)
      .then(async (res) => {
        const uppercaseResponse = res.body
        return await request(server)
          .get(`/test/resource1?name__regex=${name.toLowerCase()}`)
          .then((res) => {
            const lowercaseResponse = res.body
            t.is(uppercaseResponse.length, lowercaseResponse.length)
          })
      })
  })
}
