import { Injectable } from '@nestjs/common';
import followRedirects, { https, maxRedirects } from 'follow-redirects';


@Injectable()
export class ProxyService {
    async proxyify({ url, response, request }) {

        // TODO: fix this method later


    }
}