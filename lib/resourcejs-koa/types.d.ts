import { type Model, type SchemaType, type QueryOptions, type Query, type PipelineStage, type SaveOptions, type ClientSession } from 'mongoose'
import { type OpenAPIV3 } from 'openapi-types'
import { type Application, type Middleware } from 'koa'
import { type RouterContext } from '@koa/router'
import { type TestOperation } from 'fast-json-patch'

type Methods = 'index' | 'get' | 'virtual' | ModifyMethods

type ModifyMethods = 'post' | 'put' | 'patch' | 'delete'

type QueryParam = string | string[] | qs.ParsedQs | qs.ParsedQs[] | boolean | undefined

interface ResourceModel extends Model<any> {
  pipeline?: PipelineStage[]
}

interface MongooseSchemaType extends SchemaType {
  enumValues?: any[]
  options?: SchemaTypeOptions<any>
}

type Hooks = {
  [K in Methods]?: {
    before: Middleware<any, any>
    after: Middleware<any, any>
  }
}

type SetHooks<Hooks> = {
  [Property in keyof Hooks]-?: Hooks[Property];
}

/**
 * Mongoose has a lot of hidden variables that are not part of the type definitions
 */
interface MongooseQuery extends Query<any, any> {
  options?: QueryOptions
  _fields?: any
}

interface TempSchemas {
  schemas?: any
}

type ResourceContext = GetResourceContext | IndexResourceContext | PostResourceContext | DeleteResourceContext | ModifyResourceContext

interface GetResourceContext extends RouterContext {
  state: GetResourceState
}

interface IndexResourceContext extends RouterContext {
  state: QueryResourceState
}

interface PostResourceContext extends RouterContext {
  state: PostResourceState
}

interface DeleteResourceContext extends RouterContext {
  state: DeleteResourceState
}

interface ModifyResourceContext extends RouterContext {
  state: ModifyResourceState
}

interface GetResourceState extends QueryResourceState {
  search: any
}

interface PostResourceState extends ModifyResourceState {
  many: boolean
  __rMethod: 'post'
}

interface DeleteResourceState extends ModifyResourceState {
  __rMethod: 'delete'
  skipDelete: boolean
  resource: {
    deleted?: boolean
  } & ResultDoc
}

interface ModifyResourceState extends Application.DefaultState {
  __rMethod: ModifyMethods
  model: Model
  modelQuery: Query
  queryExec: Query
  query: Model | Query
  skipResource: boolean
  item?: any | any[]
  resource: {
    status: number
    name?: string
    message?: string
    patch?: TestOperation<any>
    error?: any
    item?: Record<string, any>
  }
  writeOptions: SaveOptions
  session: ClientSession
}

interface QueryResourceState extends Application.DefaultState {
  __rMethod: Methods
  model: Model
  countQuery: Query
  modelQuery: Query
  queryExec: Query
  query: Model | Query
  findQuery: Query
  skipResource: boolean
  populate?: string | string[] | null
  item?: any | any[]
  resource: ResultDoc
}

interface ResultDoc {
  status: number
  error?: any
  item?: Record<string, any>
}

interface OpenAPIDoc extends OpenAPIV3.Document {
  components: OpenAPIV3.ComponentsObject
}

interface VirtualInputOptions extends InputOptions {
  path: string
}

type InputOptions = {
  before?: Middleware<any, any>
  after?: Middleware<any, any>
  methodOptions?: boolean
  hooks?: Hooks
  convertIds?: boolean | RegExp
  queryFilter?: any
  version?: string
} & BeforeMiddlewares & AfterMiddleWares

interface VirtualMethodOptions extends MethodOptions {
  path: string
}

type MethodOptions = {
  before: Array<Middleware<any, any>>
  after: Array<Middleware<any, any>>
  methodOptions: boolean
  convertIds?: RegExp
  queryFilter?: any
  hooks: SetHooks
} & BeforeMiddlewares & AfterMiddleWares

type BeforeMiddlewares = {
  [Key in Methods as `before${Capitalize<Key>}`]?: Middleware<any, any>
}

type AfterMiddleWares = {
  [Key in Methods as `after${Capitalize<Key>}`]?: Middleware<any, any>
}

type SetOptions<Options> = {
  [Property in keyof Options]-?: Options[Property];
}

interface ConfigMiddlewares {
  beforeQuery: Middleware<any, any>
  query: Middleware<any, any>
  afterQuery: Middleware<any, any>
  after: Middleware<any, any>
}
