var url=require('url');
var express=require('express');
var app=express();
module.exports = function () {
  return function (req, res, next) {
    res.status(404).send('st');
  };
};
var on_ek='/yonlendir/';
app.use(function(req,res,next){res.header("Access-Control-Allow-Origin","*");res.header("Access-Control-Allow-Headers","Origin, X-Requested-With, Content-Type, Accept");next();});
app.use(require('unblocker')({prefix:on_ek,responseMiddleware:[]}));
app.use('/',express.static(__dirname+'/public'));
app.get("/-",function(req,res){res.redirect(on_ek+url.parse(req.url,true).query.url);}); 
app.use(function(req,res,next){res.status(500 || 404 || 200);res.redirect("desteklenmiyor.html");});
module.exports=app;
   