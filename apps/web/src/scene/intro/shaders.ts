/**
 * GLSL of the cinematic intro, verbatim from reference/NISAR-HydroStress-Cinematic-Intro.html.
 * These shaders write display-referred colour (their own `tone()` = Reinhard-ish + gamma 2.2), so
 * they deliberately do NOT include <tonemapping_fragment> / <colorspace_fragment>: a ShaderMaterial
 * without those chunks is written to the canvas as-is, exactly like in r128.
 */
export const SNOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}
float snoise(vec3 v){const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;i=mod289(i);
vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;vec4 j=p-49.*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.*x_);
vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.-abs(x)-abs(y);vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
vec4 s0=floor(b0)*2.+1.;vec4 s1=floor(b1)*2.+1.;vec4 sh=-step(h,vec4(0.));vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<7;i++){s+=a*snoise(p);p*=2.03;a*=.5;}return s;}
vec3 tone(vec3 c){c=c/(1.+c*.6);return pow(c,vec3(1./2.2));}
`;

export const ENV_VERT = /* glsl */ `varying vec3 vD;void main(){vD=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
export const ENV_FRAG = /* glsl */ `uniform vec3 sunDir;varying vec3 vD;void main(){vec3 d=normalize(vD);vec3 c=mix(vec3(.004,.006,.015),vec3(.07,.18,.4),smoothstep(.05,-.5,d.y));
float s=max(dot(d,sunDir),0.);c+=vec3(1.,.95,.85)*pow(s,400.)*60.+vec3(1.,.85,.6)*pow(s,8.)*.35;gl_FragColor=vec4(c,1.);}`;

export const STARS_VERT = /* glsl */ `attribute float size;attribute vec3 starColor;varying vec3 vC;uniform float pr;uniform float time;void main(){vC=starColor*(.75+.25*sin(time*2.+position.x));gl_PointSize=size*pr;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
export const STARS_FRAG = /* glsl */ `varying vec3 vC;void main(){float d=length(gl_PointCoord-.5);gl_FragColor=vec4(vC,smoothstep(.5,0.,d));}`;

export const EARTH_VERT = /* glsl */ `varying vec3 vN;varying vec3 vP;varying vec3 vW;void main(){vP=position;vN=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`;
export const EARTH_FRAG = /* glsl */ `uniform vec3 sunDir;varying vec3 vN;varying vec3 vP;varying vec3 vW;${SNOISE}
void main(){vec3 p=normalize(vP);float n=fbm(p*1.7+vec3(3.1,1.7,.4));float land=smoothstep(.03,.07,n);float lat=abs(p.y);float m=fbm(p*4.+7.);
 vec3 lc=mix(vec3(.10,.22,.08),vec3(.42,.33,.2),smoothstep(-.2,.3,m));float dry=smoothstep(.15,.45,lat)*(1.-smoothstep(.5,.7,lat));
 lc=mix(lc,vec3(.7,.58,.38),dry*smoothstep(-.1,.25,m+.1));lc=mix(lc,vec3(.9,.93,.97),smoothstep(.8,.88,lat+m*.05));
 vec3 oc=mix(vec3(.004,.02,.07),vec3(.02,.12,.22),smoothstep(-.25,.05,n));vec3 col=mix(oc,lc,land);
 vec3 N=normalize(vN),L=normalize(sunDir),V=normalize(cameraPosition-vW);float d=dot(N,L),diff=max(d,0.);
 vec3 H=normalize(L+V);float spec=pow(max(dot(N,H),0.),90.)*(1.-land)*1.4;vec3 c=col*(diff*1.5+.015)+vec3(1.,.9,.75)*spec*diff;
 float night=1.-smoothstep(-.2,.05,d);float city=step(.55,snoise(p*70.))*step(.25,snoise(p*9.+2.))*land*(1.-smoothstep(.6,.75,lat));
 c+=vec3(1.,.62,.28)*city*night*.9;float fr=pow(1.-max(dot(N,V),0.),3.);c+=vec3(.25,.55,1.)*fr*smoothstep(-.3,.4,d)*.9;
 gl_FragColor=vec4(tone(c),1.);}`;

export const CLOUDS_VERT = /* glsl */ `varying vec3 vN;varying vec3 vP;void main(){vP=position;vN=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
export const CLOUDS_FRAG = /* glsl */ `uniform vec3 sunDir;uniform float time;varying vec3 vN;varying vec3 vP;${SNOISE}
void main(){vec3 p=normalize(vP);float c=smoothstep(.18,.62,fbm(p*2.6+vec3(time*.004,0.,time*.002)));float d=max(dot(normalize(vN),sunDir),0.);
gl_FragColor=vec4(tone(vec3(1.)*(d*1.3+.02)),c*.72);}`;

export const ATMO_VERT = /* glsl */ `varying vec3 vNv;varying vec3 vNw;void main(){vNv=normalize(normalMatrix*normal);vNw=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
export const ATMO_FRAG = /* glsl */ `uniform vec3 sunDir;varying vec3 vNv;varying vec3 vNw;void main(){float i=pow(clamp(.74-dot(vNv,vec3(0.,0.,1.)),0.,1.),4.);float s=smoothstep(-.35,.6,dot(vNw,sunDir));gl_FragColor=vec4(vec3(.25,.55,1.)*i*s*1.3,1.);}`;

export const BEAM_VERT = /* glsl */ `varying vec2 vUv;varying vec3 vNw;varying vec3 vWp;void main(){vUv=uv;vNw=normalize(mat3(modelMatrix)*normal);vec4 w=modelMatrix*vec4(position,1.);vWp=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`;
export const BEAM_FRAG = /* glsl */ `uniform float time;uniform float opacity;varying vec2 vUv;varying vec3 vNw;varying vec3 vWp;void main(){float f=fract(vUv.y*5.+time*1.1);
 float ring=smoothstep(0.,.03,f)*smoothstep(.16,.03,f);float sweep=.6+.4*sin(vUv.x*6.2832*2.-time*3.);vec3 V=normalize(cameraPosition-vWp);float edge=pow(1.-abs(dot(normalize(vNw),V)),2.);
 float a=(.12+ring*.8*sweep)*(.25+edge)*opacity*smoothstep(0.,.15,vUv.y)*smoothstep(1.,.92,vUv.y);gl_FragColor=vec4(vec3(.32,.95,1.)*a,a);}`;
