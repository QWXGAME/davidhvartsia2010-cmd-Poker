// Комната: стол (сукно + лакированный бортик + латунные таблички), лампа с зелёным абажуром,
// световой конус, пылинки, стена с дамаском в темноте.

import * as THREE from 'three';
import {
  FELT_L, FELT_R, RAIL_H, RAIL_W, LAMP_Y, LAMP_Z, SEATS, PROPS, TABLE_Z,
  stadiumShape,
} from './layout';
import { parquetTextures, clubWallTextures, railWoodTextures } from './woods';
import { ClubDecor } from './decor';
import { FeltBakeInfo, lacquerWoodTexture, brassPlate, glowTexture, makeFeltTexture, shaftTexture } from './textures';
import { Particles } from './Particles';

export class Room {
  private decor!: ClubDecor;
  readonly group = new THREE.Group();
  readonly lamp: THREE.SpotLight;
  private feltMat: THREE.MeshBasicMaterial;
  private plates: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; text: string; active: boolean }[] = [];
  private bulbGlow: THREE.Sprite;
  private shaft: THREE.Mesh;
  readonly dust: Particles;
  readonly lampGroup = new THREE.Group();
  private bake: FeltBakeInfo;
  private quality: number;

  constructor(quality: number, feltColor: string) {
    this.quality = quality;
    const g = this.group;
    // сам стол (сукно, борт, юбка) — в своей группе, сдвинутой к игроку
    const tg = new THREE.Group();
    tg.position.z = TABLE_Z;
    g.add(tg);

    // ── сукно ──
    const shape = stadiumShape(FELT_R, FELT_L);
    const feltGeo = new THREE.ShapeGeometry(shape, 48);
    feltGeo.rotateX(-Math.PI / 2);
    const minX = -FELT_R, maxX = FELT_R, minZ = -(FELT_L + FELT_R), maxZ = FELT_L + FELT_R;
    // UV по габаритам
    const pos = feltGeo.attributes.position as THREE.BufferAttribute;
    const uv = feltGeo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) - minX) / (maxX - minX), 1 - (pos.getZ(i) - minZ) / (maxZ - minZ));
    }
    this.bake = {
      minX, maxX, minZ, maxZ, lampZ: LAMP_Z - TABLE_Z, stadium: { r: FELT_R, l: FELT_L },
      shadows: [
        // мягкая контактная окклюзия под тяжёлыми предметами (поверх неё ляжет настоящая тень)
        { x: PROPS.glass.x, z: PROPS.glass.z - TABLE_Z, rx: 0.075, rz: 0.07, a: 0.35 },
        { x: SEATS[0].stack.x, z: SEATS[0].stack.z - TABLE_Z, rx: 0.13, rz: 0.1, a: 0.2 },
      ],
    };
    // свет запечён в текстуру — тон-маппинг не трогает задуманные цвета
    this.feltMat = new THREE.MeshBasicMaterial({ map: makeFeltTexture(feltColor, this.bake, quality), toneMapped: false });
    const felt = new THREE.Mesh(feltGeo, this.feltMat);
    felt.renderOrder = -1;
    tg.add(felt);

    // ── лакированный бортик (рояльный чёрный) ──
    const outer = stadiumShape(FELT_R + RAIL_W, FELT_L);
    outer.holes.push(stadiumShape(FELT_R, FELT_L) as unknown as THREE.Path);
    const railGeo = new THREE.ExtrudeGeometry(outer, {
      depth: RAIL_H, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.03, bevelSegments: 4, curveSegments: 40,
    });
    railGeo.rotateX(-Math.PI / 2);
    railGeo.translate(0, -0.012, 0);
    // лакированное тёмное дерево: древесина под толстым слоем глянцевого лака
    // атласное полированное дерево — тот же тон, что у боковины стола; блики мягкие, без «зеркала»
    const rw = railWoodTextures(quality > 1 ? 1024 : 512);
    const wood = rw.map;
    wood.repeat.set(2.2, 2.2);
    rw.bump.repeat.set(2.2, 2.2);
    void lacquerWoodTexture;
    const railMat = new THREE.MeshPhysicalMaterial({
      // как на фото: чёрный лак поверх эбенового дерева — глубокие мягкие блики, волокно едва проступает
      // тёмное дерево под атласным лаком: без серого «стеклянного» отражения под острым углом
      map: wood, bumpMap: rw.bump, bumpScale: 0.25, color: new THREE.Color(0.62, 0.46, 0.38), roughness: 0.5, metalness: 0.0, envMapIntensity: 0.55,
      clearcoat: 0.85, clearcoatRoughness: 0.16, specularIntensity: 0.45, sheen: 0.3, sheenColor: new THREE.Color(0x6a2a18), sheenRoughness: 0.5,
    });
    // верхняя грань выдавленного «стадиона» с отверстием смотрела вниз и отсекалась — сквозь борт был виден пол
    railMat.side = THREE.DoubleSide;
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.receiveShadow = false;   // тени рукавов на лаке под острым углом давали «пилу»
    tg.add(rail);
    // деревянная окантовка по внутреннему краю сукна (racetrack) — тем же деревом, что бортик
    const race = stadiumShape(FELT_R + 0.004, FELT_L);
    race.holes.push(stadiumShape(FELT_R - 0.075, FELT_L) as unknown as THREE.Path);
    const raceGeo = new THREE.ExtrudeGeometry(race, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 3, curveSegments: 40 });
    raceGeo.rotateX(-Math.PI / 2);
    // без текстуры (UV вытянутой формы дают «пилу»): тот же тон тёмного лакированного дерева
    const raceMesh = new THREE.Mesh(raceGeo, new THREE.MeshPhysicalMaterial({ map: wood, color: new THREE.Color(0.62, 0.46, 0.38), roughness: 0.5, clearcoat: 0.85, clearcoatRoughness: 0.16, envMapIntensity: 0.55, specularIntensity: 0.45, side: THREE.DoubleSide }));
    raceMesh.receiveShadow = false;
    tg.add(raceMesh);
    // латунная инкрустация по внутренней кромке окантовки — деталь дорогих клубных столов
    const inlay = stadiumShape(FELT_R - 0.062, FELT_L);
    inlay.holes.push(stadiumShape(FELT_R - 0.068, FELT_L) as unknown as THREE.Path);
    const inlayGeo = new THREE.ExtrudeGeometry(inlay, { depth: 0.0012, bevelEnabled: false, curveSegments: 48 });
    inlayGeo.rotateX(-Math.PI / 2);
    inlayGeo.translate(0, 0.0092, 0);
    tg.add(new THREE.Mesh(inlayGeo, new THREE.MeshStandardMaterial({ color: 0xc9a253, metalness: 1, roughness: 0.28, envMapIntensity: 1.4, side: THREE.DoubleSide })));

    // юбка стола — тёмное дерево
    const skirtShape = stadiumShape(FELT_R + RAIL_W - 0.01, FELT_L);
    skirtShape.holes.push(stadiumShape(FELT_R + RAIL_W - 0.05, FELT_L) as unknown as THREE.Path);
    const skirtGeo = new THREE.ExtrudeGeometry(skirtShape, { depth: 0.2, bevelEnabled: false, curveSegments: 32 });
    skirtGeo.rotateX(-Math.PI / 2);
    skirtGeo.translate(0, -0.22, 0);
    tg.add(new THREE.Mesh(skirtGeo, new THREE.MeshPhysicalMaterial({ map: wood, color: new THREE.Color(0.28, 0.24, 0.22), roughness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.2, envMapIntensity: 0.8 })));

    // ── латунные таблички с именами ──
    const plateGeo = new THREE.BoxGeometry(0.19, 0.004, 0.06);
    const cornerR = FELT_R + RAIL_W * 0.5;
    const corner = (sign: number) => {
      const th = sign * 0.82;
      return { pos: new THREE.Vector3(Math.sin(th) * cornerR, 0, TABLE_Z + FELT_L + Math.cos(th) * cornerR), rot: th };
    };
    const placements = SEATS.map((s, i) => (i === 0 ? corner(-1) : { pos: s.plate, rot: Math.abs(s.out.x) > 0.99 ? Math.PI / 2 * -Math.sign(s.out.x) : Math.atan2(s.out.x, s.out.z) }));
    placements.push(corner(1));
    placements.forEach((pl, i) => {
      const mat = new THREE.MeshStandardMaterial({
        map: brassPlate(i === SEATS.length ? 'Poker Noir' : ''), metalness: 0.8, roughness: 0.34, envMapIntensity: 1.5,
        emissive: new THREE.Color(0x000000),
      });
      const mesh = new THREE.Mesh(plateGeo, mat);
      mesh.position.copy(pl.pos).setY(RAIL_H + 0.024);
      mesh.rotation.y = pl.rot;
      // таблички с именами убраны (минимализм) — объект живёт, но в сцену не добавляется
      void g;
      if (i < SEATS.length) this.plates.push({ mesh, mat, text: '', active: false });
    });

    // ── лампа: зелёный абажур ──
    const lampGroup = this.lampGroup;
    lampGroup.position.set(0, LAMP_Y, LAMP_Z);
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const r = 0.06 + Math.pow(t, 1.15) * 0.4;
      prof.push(new THREE.Vector2(r, 0.3 - t * 0.3));
    }
    prof.reverse(); // нормали наружу
    const shadeGeo = new THREE.LatheGeometry(prof, 48);
    const shadeOut = new THREE.MeshStandardMaterial({
      color: 0x0f4a2c, roughness: 0.22, metalness: 0.1, emissive: 0x062a16, envMapIntensity: 1.6, side: THREE.FrontSide,
    });
    const shadeIn = new THREE.MeshBasicMaterial({ color: 0xffe2b0, side: THREE.BackSide });
    lampGroup.add(new THREE.Mesh(shadeGeo, shadeOut));
    const inner = new THREE.Mesh(shadeGeo, shadeIn);
    inner.scale.setScalar(0.985);
    lampGroup.add(inner);
    // латунный ободок
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.46, 0.007, 8, 64),
      new THREE.MeshStandardMaterial({ color: 0xc9a24e, metalness: 0.9, roughness: 0.3 }),
    );
    rim.rotation.x = Math.PI / 2;
    lampGroup.add(rim);
    // матовый рассеиватель — яркий тёплый диск, как на референсе
    const diffuser = new THREE.Mesh(
      new THREE.CircleGeometry(0.43, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.05, 1.5), side: THREE.DoubleSide }),
    );
    diffuser.rotation.x = Math.PI / 2;
    diffuser.position.y = 0.004;
    lampGroup.add(diffuser);
    // шнур
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 3, 6), new THREE.MeshBasicMaterial({ color: 0x050403 }));
    cord.position.y = 0.32 + 1.5;
    lampGroup.add(cord);
    // свечение лампочки
    this.bulbGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture('rgba(255,236,200,1)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9,
    }));
    this.bulbGlow.scale.set(1.5, 0.7, 1);
    this.bulbGlow.position.y = -0.02;
    lampGroup.add(this.bulbGlow);
    // абажур скрыт — от лампы остаётся только свет
    lampGroup.visible = false;
    g.add(lampGroup);

    // световой конус
    const shaftGeo = new THREE.CylinderGeometry(0.44, 1.25, LAMP_Y - 0.02, 40, 1, true);
    this.shaft = new THREE.Mesh(shaftGeo, new THREE.MeshBasicMaterial({
      map: shaftTexture(), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    this.shaft.position.set(0, (LAMP_Y - 0.02) / 2 + 0.01, LAMP_Z);
    this.shaft.visible = false;
    g.add(this.shaft);

    // сам свет
    this.lamp = new THREE.SpotLight(0xffd9a8, 7, 7, 1.05, 0.8, 1.2);
    this.lamp.position.set(0, LAMP_Y + 0.05, LAMP_Z);
    this.lamp.target.position.set(0, 0, LAMP_Z + 0.25);
    this.lamp.castShadow = true;
    const sm = quality > 1 ? 2048 : 1024;
    this.lamp.shadow.mapSize.set(sm, sm);
    this.lamp.shadow.camera.near = 0.3;
    this.lamp.shadow.camera.far = 4;
    this.lamp.shadow.bias = -0.0008;
    this.lamp.shadow.normalBias = 0.016;
    this.lamp.shadow.radius = quality > 1 ? 5 : 3;
    this.lamp.shadow.blurSamples = 10;
    // слой теней поверх запечённого сукна: бархат остаётся своим, тени ложатся мягко
    const shadowLayer = new THREE.Mesh(feltGeo, new THREE.ShadowMaterial({ color: 0x0b0204, opacity: 0.68, depthWrite: false }));
    shadowLayer.position.y = 0.0006;
    shadowLayer.receiveShadow = true;
    shadowLayer.renderOrder = 0;
    tg.add(shadowLayer);
    g.add(this.lamp, this.lamp.target);
    // отражённый от бордового сукна свет: снизу подсвечивает лица, ладони и манжеты сидящих — нуарный «свет от стола»
    const bounce = new THREE.DirectionalLight(0xa0303a, 0.9);
    bounce.position.set(0, -1, 0.3);
    bounce.target.position.set(0, 1, -0.2);
    g.add(bounce, bounce.target);

    // пылинки в луче
    this.dust = new Particles(quality > 1 ? 90 : 50, {
      additive: true, color: new THREE.Color(1, 0.85, 0.6), texture: glowTexture('rgba(255,240,210,1)'),
    });
    this.dust.forEach((p) => {
      p.x = (Math.random() - 0.5) * 0.9; p.y = 0.15 + Math.random() * 0.9; p.z = LAMP_Z + (Math.random() - 0.5) * 0.9;
      p.size = 0.004 + Math.random() * 0.006; p.alpha = 0.08 + Math.random() * 0.22;
      p.vx = (Math.random() - 0.5) * 0.01; p.vy = (Math.random() - 0.5) * 0.006; p.vz = (Math.random() - 0.5) * 0.01;
    });
    g.add(this.dust.points);

    // ── клуб 1920-х: паркет «ёлочкой» под лаком и стены в панелях буазери ──
    const FLOOR_Y = -0.75, WALL_H = 3.4, BACK = -3.6, SIDE = 3.4, FRONT = 4.2;
    const pq = parquetTextures(quality > 1 ? 1024 : 512);
    for (const t of [pq.map, pq.rough, pq.bump]) t.repeat.set(16, 16);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(SIDE * 2, FRONT - BACK),
      new THREE.MeshStandardMaterial({
        map: pq.map, roughnessMap: pq.rough, bumpMap: pq.bump, bumpScale: 0.6,
        roughness: 1, metalness: 0, envMapIntensity: 0.9, color: 0xd8c8c0,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, FLOOR_Y, (FRONT + BACK) / 2);
    floor.receiveShadow = false;
    g.add(floor);
    const bo = clubWallTextures(quality > 1 ? 512 : 256);
    // одна общая текстура на все стены (одна загрузка, один материал); повтор секций — через UV геометрии
    const wallM = new THREE.MeshStandardMaterial({ map: bo.map, bumpMap: bo.bump, bumpScale: 1.2, roughness: 0.55, metalness: 0, envMapIntensity: 0.6, color: 0xd8c8c0 });
    const wallMat = (_len: number) => wallM;
    const wallGeo = (len: number) => {
      const geo = new THREE.PlaneGeometry(len, WALL_H);
      const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 1.7);
      return geo;
    };
    const back = new THREE.Mesh(wallGeo(SIDE * 2), wallMat(SIDE * 2));
    back.position.set(0, FLOOR_Y + WALL_H / 2, BACK);
    const sideLen = FRONT - BACK;
    const left = new THREE.Mesh(wallGeo(sideLen), wallMat(sideLen));
    left.rotation.y = Math.PI / 2;
    left.position.set(-SIDE, FLOOR_Y + WALL_H / 2, (FRONT + BACK) / 2);
    const right = left.clone();
    right.material = wallMat(sideLen);
    right.rotation.y = -Math.PI / 2;
    right.position.x = SIDE;
    g.add(back, left, right);
    // потолок — тёмный кессон, просто чтобы сверху не было пустоты
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(SIDE * 2, sideLen), new THREE.MeshStandardMaterial({ color: 0x0c0706, roughness: 0.9 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, FLOOR_Y + WALL_H, (FRONT + BACK) / 2);
    g.add(ceil);
    // тёплые бра на стенах: свет без теней, только чтобы проступило дерево панелей
    // (каждый источник стоит времени в каждом пикселе — на ПК два бра, на телефоне ни одного: стены слегка светятся сами)
    if (quality <= 1) for (const w of [back, left, right]) (w.material as THREE.MeshStandardMaterial).emissive.setRGB(0.05, 0.025, 0.015);
    for (const [x, z] of quality > 1 ? [[-2.4, BACK + 0.35], [2.4, BACK + 0.35]] : []) {
      const l = new THREE.PointLight(0xff9a50, 2.2, 3.6, 1.5);
      l.position.set(x, 1.5, z);
      g.add(l);
    }

    // убранство клуба: бра, бар с бутылками, картины, ковёр, дымка
    this.decor = new ClubDecor({ FLOOR_Y, WALL_H, BACK, SIDE, FRONT }, quality);
    g.add(this.decor.group);
  }

  /** Лампа поднимается в портретном ракурсе (чтобы не закрывать стол) и опускается в ландшафтном. */
  setLampY(y: number) {
    this.lampGroup.position.y = y;
    this.lamp.position.y = y + 0.05;
    this.shaft.scale.y = (y - 0.02) / (LAMP_Y - 0.02);
    this.shaft.position.y = (y - 0.02) / 2 + 0.01;
  }

  setFelt(color: string) {
    const old = this.feltMat.map;
    this.feltMat.map = makeFeltTexture(color, this.bake, this.quality);
    this.feltMat.needsUpdate = true;
    old?.dispose();
  }

  setPlate(visualSeat: number, text: string, active: boolean) {
    const p = this.plates[visualSeat];
    if (p.text !== text) {
      p.text = text;
      p.mat.map?.dispose();
      p.mat.map = brassPlate(text);
      p.mat.emissiveMap = p.mat.map;
      p.mat.needsUpdate = true;
    }
    p.active = active;
  }

  update(t: number, dt: number) {
    this.decor?.update(t, dt);
    // дыхание света лампы
    const flick = 1 + Math.sin(t * 1.7) * 0.015 + Math.sin(t * 7.3) * 0.006;
    this.lamp.intensity = 7 * flick;
    (this.bulbGlow.material as THREE.SpriteMaterial).opacity = 0.7 * flick;
    for (const p of this.plates) {
      const target = p.active ? 0.35 + Math.sin(t * 4) * 0.15 : 0;
      p.mat.emissive.setScalar(p.mat.emissive.r + (target - p.mat.emissive.r) * Math.min(1, dt * 8));
    }
    this.dust.forEach((p) => {
      p.x += p.vx * dt + Math.sin(t * 0.3 + p.seed * 10) * 0.0008;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y > this.lampGroup.position.y - 0.05 || p.y < 0.1) p.vy *= -1;
      const rr = 0.18 + (1 - p.y / this.lampGroup.position.y) * 0.5; // внутри конуса
      if (Math.abs(p.x) > rr) p.vx = -Math.sign(p.x) * Math.abs(p.vx);
      if (Math.abs(p.z - LAMP_Z) > rr) p.vz = -Math.sign(p.z - LAMP_Z) * Math.abs(p.vz);
    });
    this.dust.commit();
  }
}
