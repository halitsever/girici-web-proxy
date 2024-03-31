import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ProxyDto } from './dto/proxy.dto';
import { ProxyService } from './proxy.service';

@Controller('proxy')
export class ProxyController {
    constructor(private readonly proxyService: ProxyService) { }


    // TODO: use auth guard
    @Get()
    async proxy(@Query() query: ProxyDto, @Res() response, @Req() request) {
        const { url } = query;

        return this.proxyService.proxyify({ url, response, request });
    }

}
