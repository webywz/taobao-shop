declare module "ali-oss" {
  export type SignatureMethod = "GET" | "PUT" | "POST" | "DELETE" | "HEAD"

  export interface OSSOptions {
    region: string
    accessKeyId?: string
    accessKeySecret?: string
    bucket: string
    endpoint?: string
    secure?: boolean
    cname?: boolean
  }

  export interface SignatureUrlOptions {
    method?: SignatureMethod
    expires?: number
  }

  export default class OSS {
    constructor(options: OSSOptions)
    signatureUrl(objectName: string, options?: SignatureUrlOptions): string
  }
}
