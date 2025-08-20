// raytrace.js
// RayTrace (Web) - Minimal, fast build with human-centered difficulty model
// No build tools needed. Just open index.html (use a local server) or deploy to GitHub Pages.

// -------------------- Config & Constants --------------------
const VIRTUAL_W = 1000, VIRTUAL_H = 1000;
const FPS = 60;

const COLOR_BG = [20, 22, 28];
const COLOR_EMITTER = [60, 170, 255];
const COLOR_TARGET = [255, 100, 100];
const COLOR_REFLECTOR = [220, 220, 235];
const COLOR_NOISE_REFLECTOR = [150, 150, 170];
const COLOR_BLOCKER = [200, 120, 255];
const COLOR_BEAM = [255, 255, 150];
const COLOR_TEXT = [235, 240, 250];
const COLOR_TEXT_DIM = [160, 170, 190];
const COLOR_TIMER_WARN = [255, 120, 120];
const COLOR_BORDER = [60, 66, 80];

const ROUND_TIME = 60.0;
const MAX_BOUNCES = 20;
const CORNER_TOL_FRAC = 0.02;
const RAY_EPS = 1e-6;
const STEP_EPS = 1e-3;

const EMITTER_RADIUS = 8;
const BEAM_SPEED = 1600.0;

const SAFE_MARGIN = 60;

function difficultyParams(roundNum) {
  const num_reflections = Math.min(1 + Math.floor((roundNum - 1) / 2), 8); // 1,1,2,2,3,3,...
  const num_noise = Math.min(roundNum, 12);
  const target_size = Math.max(26, 90 - 6 * (roundNum - 1));
  return { num_reflections, num_noise, target_size };
}

const TIME_BONUS_FACTOR = 0.25;
const BASE_SCORE_SCALE = 10.0;

const ANGLE_NOISE_SIGMA_DEG = 1.5;
const HIGH_SCORE_KEY = "raytrace_highscore_v1";

// -------------------- Utils --------------------
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

class RNG {
  constructor(seed = Date.now() >>> 0) {
    this.state = seed >>> 0;
  }
  // xorshift32
  next() {
    let x = this.state;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17; x >>>= 0;
    x ^= x << 5; x >>>= 0;
    this.state = x >>> 0;
    return (x >>> 0) / 0xFFFFFFFF;
  }
  uniform(a, b) { return a + (b - a) * this.next(); }
}

// erf approximation (Abramowitz & Stegun 7.1.26)
function erf(x) {
  const sign = Math.sign(x);
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
function Phi(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }

// -------------------- Vector & Geometry --------------------
function v_add(a, b){ return [a[0]+b[0], a[1]+b[1]]; }
function v_sub(a, b){ return [a[0]-b[0], a[1]-b[1]]; }
function v_mul(a, s){ return [a[0]*s, a[1]*s]; }
function v_dot(a, b){ return a[0]*b[0] + a[1]*b[1]; }
function v_cross(a, b){ return a[0]*b[1] - a[1]*b[0]; }
function v_len(a){ return Math.hypot(a[0], a[1]); }
function v_len2(a){ return a[0]*a[0] + a[1]*a[1]; }
function v_norm(a){ const l = v_len(a); return l <= 1e-12 ? [0,0] : [a[0]/l, a[1]/l]; }
function v_perp(a){ return [-a[1], a[0]]; }
function v_dist(a, b){ return v_len(v_sub(a, b)); }
function v_rot(a, ang){ const ca = Math.cos(ang), sa = Math.sin(ang); return [a[0]*ca - a[1]*sa, a[0]*sa + a[1]*ca]; }
function reflect(vec, normal_unit){ const d = v_dot(vec, normal_unit); return v_sub(vec, v_mul(normal_unit, 2.0*d)); }
function angle_of(v){ return Math.atan2(v[1], v[0]); }
function angle_diff(a, b){ const d = (a - b + Math.PI) % (2*Math.PI) - Math.PI; return Math.abs(d); }

function line_line_intersection(A, B, C, D) {
  const r = v_sub(B, A);
  const s = v_sub(D, C);
  const rxs = v_cross(r, s);
  if (Math.abs(rxs) < 1e-12) return null;
  const t = v_cross(v_sub(C, A), s)/rxs;
  const u = v_cross(v_sub(C, A), r)/rxs;
  const P = v_add(A, v_mul(r, t));
  return [t, u, P];
}
function project_point_to_line(P, A, B) {
  const AB = v_sub(B, A);
  const L2 = v_len2(AB);
  if (L2 <= 1e-12) return [0.0, A];
  const t = v_dot(v_sub(P, A), AB)/L2;
  return [t, v_add(A, v_mul(AB, t))];
}
function point_to_line_distance(P, A, B) {
  const [,H] = project_point_to_line(P, A, B);
  return v_dist(P, H);
}
function ray_segment_intersection(p, r, a, b) {
  const s = v_sub(b, a);
  const rxs = v_cross(r, s);
  if (Math.abs(rxs) < 1e-12) return null;
  const qp = v_sub(a, p);
  const t = v_cross(qp, s)/rxs;
  const u = v_cross(qp, r)/rxs;
  if (t > RAY_EPS && u >= 0.0 && u <= 1.0) {
    const hit = v_add(p, v_mul(r, t));
    return [t, u, hit];
  }
  return null;
}
function ray_aabb_intersection(p, r, aabb) {
  const [x,y,w,h] = aabb;
  const minx = x, miny = y, maxx = x+w, maxy = y+h;
  let tmin = -Infinity, tmax = Infinity;
  for (let i=0;i<2;i++){
    const o = p[i], d = r[i];
    const mn = i===0 ? minx : miny;
    const mx = i===0 ? maxx : maxy;
    if (Math.abs(d) < 1e-12) {
      if (o < mn || o > mx) return null;
    } else {
      const t1 = (mn - o)/d;
      const t2 = (mx - o)/d;
      const lo = Math.min(t1, t2);
      const hi = Math.max(t1, t2);
      tmin = Math.max(tmin, lo);
      tmax = Math.min(tmax, hi);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < RAY_EPS) return null;
  if (tmin > RAY_EPS) return tmin;
  else if (tmax > RAY_EPS) return tmax;
  return null;
}
function ray_aabb_exit_distance_from_inside(p, r, aabb) {
  const [x,y,w,h] = aabb;
  const minx = x, miny = y, maxx = x+w, maxy = y+h;
  let tmax = Infinity;
  for (let i=0;i<2;i++){
    const o = p[i], d = r[i];
    const mn = i===0 ? minx : miny;
    const mx = i===0 ? maxx : maxy;
    if (Math.abs(d) < 1e-12) continue;
    const t1 = (mn - o)/d, t2 = (mx - o)/d;
    const hi = Math.max(t1, t2);
    tmax = Math.min(tmax, hi);
  }
  return tmax > RAY_EPS ? tmax : null;
}

// -------------------- Entities --------------------
class Reflector {
  constructor(a, b, is_noise=false, is_blocker=false){
    this.a = a; this.b = b;
    this.is_noise = is_noise;
    this.is_blocker = is_blocker;
  }
  direction(){ return v_norm(v_sub(this.b, this.a)); }
  normal(){
    const t = this.direction();
    const n = v_perp(t);
    const l = v_len(n);
    return l <= 1e-12 ? [0,0] : [n[0]/l, n[1]/l];
  }
}
class Target {
  constructor(x,y,w,h){ this.x=x; this.y=y; this.w=w; this.h=h; }
  center(){ return [this.x + this.w/2, this.y + this.h/2]; }
  aabb(){ return [this.x, this.y, this.w, this.h]; }
}

// -------------------- Level Generation & Difficulty --------------------
class Level {
  constructor(roundNum, rng){
    this.round_num = roundNum;
    this.rng = rng;
    this.reflectors = [];
    this.target = null;
    this.emitter = [0,0];
    this.solution_points = [];
    this.solution_first_dir = [0,0];
    this.bounds = [0,0, VIRTUAL_W, VIRTUAL_H];
    const {num_reflections, num_noise, target_size} = difficultyParams(roundNum);
    this.num_reflections = num_reflections;
    this.num_noise = num_noise;
    this.target_size = target_size;
    this.difficulty_score = 100.0;
    this.aim_tolerance_deg = 0.0;
    this._build_level();
  }

  _rand_point_in_safe_area(){
    const x = this.rng.uniform(SAFE_MARGIN, VIRTUAL_W - SAFE_MARGIN);
    const y = this.rng.uniform(SAFE_MARGIN, VIRTUAL_H - SAFE_MARGIN);
    return [x,y];
  }
  _rand_direction(){
    const ang = this.rng.uniform(0, 2*Math.PI);
    return [Math.cos(ang), Math.sin(ang)];
  }
  _place_emitter_and_target(){
    for (let i=0;i<200;i++){
      const e = this._rand_point_in_safe_area();
      const t = this._rand_point_in_safe_area();
      if (v_dist(e,t) > 300){
        this.emitter = e;
        this.target = new Target(t[0]-this.target_size/2, t[1]-this.target_size/2, this.target_size, this.target_size);
        return;
      }
    }
    this.emitter = [SAFE_MARGIN * 2, VIRTUAL_H/2];
    this.target = new Target(VIRTUAL_W - SAFE_MARGIN*2 - this.target_size, VIRTUAL_H/2 - this.target_size/2, this.target_size, this.target_size);
  }

  _build_level(){
    for (let attempt=0; attempt<120; attempt++){
      this.reflectors.length = 0;
      this.solution_points.length = 0;
      this._place_emitter_and_target();
      const ok = this._build_solution_path_and_reflectors();
      if (!ok) continue;
      if (!this._validate_solution_path()) continue;
      if (!this._add_noise_reflectors_preserving_solution()) continue;
      if (!this._ensure_no_direct_shot()) continue;
      this._compute_difficulty_score();
      return;
    }
    // Fallback
    this._fallback_level();
    this._ensure_no_direct_shot();
    this._compute_difficulty_score();
  }

  _fallback_level(){
    this.num_reflections = 1;
    this.num_noise = 0;
    this.target_size = 80;
    this._place_emitter_and_target();
    const t_center = this.target.center();
    const mid = [(this.emitter[0]+t_center[0])/2, (this.emitter[1]+t_center[1])/2];
    const n = this._rand_direction();
    const tvec = v_perp(n);
    const L = 240;
    const a = v_sub(mid, v_mul(tvec, L*0.5));
    const b = v_add(mid, v_mul(tvec, L*0.5));
    this.reflectors = [new Reflector(a,b)];
    this.solution_points = [this.emitter, mid, t_center];
    this.solution_first_dir = v_norm(v_sub(mid, this.emitter));
  }

  _build_solution_path_and_reflectors(){
    const N = this.num_reflections;
    const t_center = this.target.center();

    const Q = [t_center];
    const D = [];

    let base = v_norm(v_sub(this.emitter, t_center));
    if (v_len(base) < 1e-6) base = this._rand_direction();
    const jitter = this.rng.uniform(-Math.PI/3, Math.PI/3);
    const base_rot = v_rot(base, jitter);
    D.push(v_norm(base_rot));

    const min_seg = 180, max_seg = 320;

    for (let i=1; i<=N; i++){
      let success_point = false;
      for (let k=0;k<60;k++){
        const dist = this.rng.uniform(min_seg, max_seg);
        const q_next = v_add(Q[i-1], v_mul(D[i-1], dist));
        if (SAFE_MARGIN < q_next[0] && q_next[0] < VIRTUAL_W - SAFE_MARGIN &&
            SAFE_MARGIN < q_next[1] && q_next[1] < VIRTUAL_H - SAFE_MARGIN) {
          Q.push(q_next);
          success_point = true;
          break;
        } else {
          const jit = this.rng.uniform(-Math.PI/6, Math.PI/6);
          D[i-1] = v_norm(v_rot(D[i-1], jit));
        }
      }
      if (!success_point) return false;

      if (i === N){
        const d_to_emitter = v_norm(v_sub(this.emitter, Q[i]));
        if (v_len(d_to_emitter) < 1e-6) return false;
        D.push(d_to_emitter);
      } else {
        let chosen = null;
        for (let k=0;k<80;k++){
          const cand = this._rand_direction();
          if (Math.abs(v_dot(cand, D[i-1])) < 0.92){ chosen = cand; break; }
        }
        if (!chosen) chosen = v_perp(D[i-1]);
        D.push(v_norm(chosen));
      }
    }

    const reflectors = [];
    for (let i=1; i<=N; i++){
      const din = D[i-1], dout = D[i];
      const diff = v_sub(din, dout);
      if (v_len(diff) < 1e-6) return false;
      const n = v_norm(diff);
      const tvec = v_perp(n);
      const L = this.rng.uniform(160, 260);
      let a = v_sub(Q[i], v_mul(tvec, L*0.5));
      let b = v_add(Q[i], v_mul(tvec, L*0.5));
      let shrink = 1.0;
      for (let s=0; s<10; s++){
        if (SAFE_MARGIN <= a[0] && a[0] <= VIRTUAL_W - SAFE_MARGIN &&
            SAFE_MARGIN <= a[1] && a[1] <= VIRTUAL_H - SAFE_MARGIN &&
            SAFE_MARGIN <= b[0] && b[0] <= VIRTUAL_W - SAFE_MARGIN &&
            SAFE_MARGIN <= b[1] && b[1] <= VIRTUAL_H - SAFE_MARGIN) {
          break;
        }
        shrink *= 0.85;
        a = v_sub(Q[i], v_mul(tvec, L*0.5*shrink));
        b = v_add(Q[i], v_mul(tvec, L*0.5*shrink));
      }
      reflectors.push(new Reflector(a,b,false,false));
    }
    this.reflectors = reflectors;

    const forward_points = [this.emitter, ...Q.slice(1).reverse(), t_center];
    this.solution_points = forward_points;
    if (forward_points.length >= 2){
      this.solution_first_dir = v_norm(v_sub(forward_points[1], forward_points[0]));
    } else {
      this.solution_first_dir = v_norm(v_sub(t_center, this.emitter));
    }
    return true;
  }

  _raycast_path(origin, direction, max_bounces=MAX_BOUNCES, return_events=false){
    const points = [origin.slice()];
    let dir_curr = v_norm(direction);
    let last_reflector = null;
    let hit_target = false;
    let hit_reason = "miss";
    const events = [];

    for (let bounce=0; bounce<=max_bounces; bounce++){
      let nearest_t = Infinity, nearest_reflector_idx = null, nearest_point = null;
      let nearest_is_target = false;
      let nearest_u = null;

      for (let idx=0; idx<this.reflectors.length; idx++){
        if (idx === last_reflector) continue;
        const r = this.reflectors[idx];
        const inter = ray_segment_intersection(points[points.length-1], dir_curr, r.a, r.b);
        if (inter){
          const [t,u,hitp] = inter;
          const tol = CORNER_TOL_FRAC;
          if (u < tol || u > 1 - tol){
            if (t < nearest_t){
              nearest_t = t; nearest_point = hitp; nearest_reflector_idx = -2; nearest_u = u;
            }
            continue;
          }
          if (t < nearest_t){
            nearest_t = t; nearest_point = hitp; nearest_reflector_idx = idx; nearest_u = u;
          }
        }
      }

      const t_target = ray_aabb_intersection(points[points.length-1], dir_curr, this.target.aabb());
      if (t_target !== null && t_target < nearest_t){
        nearest_t = t_target;
        nearest_point = v_add(points[points.length-1], v_mul(dir_curr, t_target));
        nearest_is_target = true;
        nearest_reflector_idx = null; nearest_u = null;
      }

      const t_exit = ray_aabb_exit_distance_from_inside(points[points.length-1], dir_curr, this.bounds);
      if (t_exit !== null && t_exit < nearest_t){
        nearest_t = t_exit;
        nearest_point = v_add(points[points.length-1], v_mul(dir_curr, t_exit));
        nearest_is_target = false;
        nearest_reflector_idx = null; nearest_u = null;
      }

      if (!nearest_point){
        const far = v_add(points[points.length-1], v_mul(dir_curr, 9999.0));
        points.push(far);
        hit_reason = "miss";
        break;
      }

      points.push(nearest_point);

      if (nearest_is_target){
        hit_target = true; hit_reason = "hit";
        if (return_events) events.push({type:"target", t:nearest_t, point:nearest_point});
        break;
      }
      if (nearest_reflector_idx === null){
        hit_reason = "miss";
        if (return_events) events.push({type:"exit", t:nearest_t, point:nearest_point});
        break;
      }
      if (nearest_reflector_idx === -2){
        hit_reason = "dud";
        if (return_events) events.push({type:"endpoint_dud", t:nearest_t, point:nearest_point, u:nearest_u});
        break;
      }

      const refl = this.reflectors[nearest_reflector_idx];
      const n = refl.normal();
      if (return_events) events.push({type:"reflector", idx:nearest_reflector_idx, t:nearest_t, u:nearest_u, point:nearest_point});
      dir_curr = v_norm(reflect(dir_curr, n));
      last_reflector = nearest_reflector_idx;
      points[points.length-1] = v_add(points[points.length-1], v_mul(dir_curr, STEP_EPS));
    }

    if (return_events) return [points, hit_target, hit_reason, events];
    return [points, hit_target, hit_reason];
  }

  _validate_solution_path(){
    if (v_len(this.solution_first_dir) < 1e-6) return false;
    const [,hit] = this._raycast_path(this.emitter, this.solution_first_dir, MAX_BOUNCES);
    return hit;
  }

  _segments_too_close([a1,b1],[a2,b2], threshold){
    const mid1 = [(a1[0]+b1[0])/2, (a1[1]+b1[1])/2];
    const mid2 = [(a2[0]+b2[0])/2, (a2[1]+b2[1])/2];
    if (v_dist(a1,a2) < threshold || v_dist(a1,b2) < threshold ||
        v_dist(b1,a2) < threshold || v_dist(b1,b2) < threshold) return true;
    if (v_dist(mid1,mid2) < threshold) return true;
    return false;
  }

  _add_noise_reflectors_preserving_solution(){
    let attempts = 0, added = 0;
    while (added < this.num_noise && attempts < 300){
      attempts++;
      const center = this._rand_point_in_safe_area();
      const ang = this.rng.uniform(0, Math.PI);
      const tvec = [Math.cos(ang), Math.sin(ang)];
      const L = this.rng.uniform(120, 240);
      const a = v_sub(center, v_mul(tvec, L*0.5));
      const b = v_add(center, v_mul(tvec, L*0.5));

      let too_close = false;
      for (const r of this.reflectors){
        if (this._segments_too_close([a,b],[r.a,r.b], 22.0)) { too_close = true; break; }
      }
      if (too_close) continue;

      this.reflectors.push(new Reflector(a,b,true,false));
      if (this._validate_solution_path()) added++;
      else this.reflectors.pop();
    }
    return true;
  }

  _first_event_kind(origin, direction){
    const dir_unit = v_norm(direction);
    let nearest_t = Infinity;
    let kind = "exit";
    for (let idx=0; idx<this.reflectors.length; idx++){
      const r = this.reflectors[idx];
      const inter = ray_segment_intersection(origin, dir_unit, r.a, r.b);
      if (inter){
        const [t] = inter;
        if (t < nearest_t){ nearest_t = t; kind = "reflector"; }
      }
    }
    const t_target = ray_aabb_intersection(origin, dir_unit, this.target.aabb());
    if (t_target !== null && t_target < nearest_t){ nearest_t = t_target; kind = "target"; }
    const t_exit = ray_aabb_exit_distance_from_inside(origin, dir_unit, this.bounds);
    if (t_exit !== null && t_exit < nearest_t){ nearest_t = t_exit; kind = "exit"; }
    return kind;
  }

  _angles_to_target_arc(){
    const [x,y,w,h] = this.target.aabb();
    const corners = [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
    const angles = corners.map(c => Math.atan2(c[1]-this.emitter[1], c[0]-this.emitter[0]));
    angles.sort((a,b)=>a-b);
    let best_gap = -1, best_i = -1;
    for (let i=0;i<angles.length;i++){
      const a = angles[i];
      const b = angles[(i+1)%angles.length] + (i===angles.length-1 ? 2*Math.PI : 0);
      const gap = b - a;
      if (gap > best_gap){ best_gap = gap; best_i = i; }
    }
    const start = angles[(best_i+1)%angles.length];
    const end = angles[best_i] + (best_i < (angles.length-1) ? 0 : 2*Math.PI);
    const width = (2*Math.PI) - best_gap;
    return [start, start + width];
  }

  _has_direct_shot(){
    const [a0, a1] = this._angles_to_target_arc();
    const width = a1 - a0;
    const samples = Math.max(21, Math.floor(width / (2*Math.PI/180*2))); // ~2°
    for (let i=0;i<=samples;i++){
      const ang = a0 + width * (i/samples);
      const dirv = [Math.cos(ang), Math.sin(ang)];
      const kind = this._first_event_kind(this.emitter, dirv);
      if (kind === "target") return [true, ang];
    }
    return [false, null];
  }

  _place_blocker_for_angle(ang){
    const dirv = [Math.cos(ang), Math.sin(ang)];
    const t_hit = ray_aabb_intersection(this.emitter, dirv, this.target.aabb());
    if (t_hit === null) return false;
    for (const frac of [0.85,0.78,0.72,0.66,0.6,0.55]){
      const pos = v_add(this.emitter, v_mul(dirv, t_hit * frac));
      const tvec = v_perp(dirv);
      const L = 160;
      const a = v_sub(pos, v_mul(tvec, L*0.5));
      const b = v_add(pos, v_mul(tvec, L*0.5));
      if (!(SAFE_MARGIN <= a[0] && a[0] <= VIRTUAL_W - SAFE_MARGIN && SAFE_MARGIN <= a[1] && a[1] <= VIRTUAL_H - SAFE_MARGIN)) continue;
      if (!(SAFE_MARGIN <= b[0] && b[0] <= VIRTUAL_W - SAFE_MARGIN && SAFE_MARGIN <= b[1] && b[1] <= VIRTUAL_H - SAFE_MARGIN)) continue;
      this.reflectors.push(new Reflector(a,b,true,true));
      if (this._validate_solution_path()) return true;
      this.reflectors.pop();
    }
    return false;
  }

  _ensure_no_direct_shot(){
    for (let k=0;k<30;k++){
      const [has_direct, ang] = this._has_direct_shot();
      if (!has_direct) return true;
      const placed = this._place_blocker_for_angle(ang);
      if (!placed){
        const dirv = [Math.cos(ang), Math.sin(ang)];
        const t_hit = ray_aabb_intersection(this.emitter, dirv, this.target.aabb());
        if (t_hit === null) break;
        const pos = v_add(this.emitter, v_mul(dirv, t_hit*0.9));
        const ang2 = ang + this.rng.uniform(-Math.PI/4, Math.PI/4);
        const tvec = [Math.cos(ang2), Math.sin(ang2)];
        const L = 120;
        const a = v_sub(pos, v_mul(tvec, L*0.5));
        const b = v_add(pos, v_mul(tvec, L*0.5));
        this.reflectors.push(new Reflector(a,b,true,true));
        if (!this._validate_solution_path()){
          this.reflectors.pop();
          return false;
        }
      }
    }
    const [ok] = this._has_direct_shot();
    return !ok;
  }

  // ---------- Difficulty ----------
  _compute_difficulty_score(){
    const base_dir = this.solution_first_dir;
    if (v_len(base_dir) < 1e-6){ this.difficulty_score = 50.0; this.aim_tolerance_deg = 0.0; return; }
    const [pts, hit, , ev_base] = this._raycast_path(this.emitter, base_dir, MAX_BOUNCES, true);
    if (!hit){ this.difficulty_score = 50.0; this.aim_tolerance_deg = 0.0; return; }

    const path_len = pts.slice(0,-1).reduce((acc,_,i)=>acc + v_dist(pts[i], pts[i+1]), 0);
    const N = ev_base.filter(e=>e.type==="reflector").length;

    const [d_plus_deg, d_minus_deg] = this._aim_tolerance_bisect(base_dir);
    this.aim_tolerance_deg = d_plus_deg + d_minus_deg;
    const sigma_deg = ANGLE_NOISE_SIGMA_DEG;
    let P_ang = Phi(d_plus_deg/sigma_deg) - Phi(-d_minus_deg/sigma_deg);
    P_ang = clamp(P_ang, 1e-4, 1.0);

    const sens = this._sensitivity_profile(base_dir, ev_base);
    let P_chain, margins;
    if (!sens){
      P_chain = P_ang; margins = [0.5];
    } else {
      const [du_dtheta_list, margins_list] = sens;
      const sigma_theta_rad = (Math.PI/180)*sigma_deg;
      const P_list = [];
      for (let i=0;i<du_dtheta_list.length;i++){
        const du = du_dtheta_list[i];
        const m = margins_list[i];
        const sigma_u = Math.abs(du) * sigma_theta_rad;
        const P_i = (sigma_u < 1e-6) ? 0.999 : clamp(2.0 * Phi(m / sigma_u) - 1.0, 1e-4, 0.999);
        P_list.push(P_i);
      }
      P_chain = P_list.reduce((a,b)=>a*b, 1.0);
      P_chain = clamp(P_chain, 1e-6, 1.0);
      margins = margins_list;
    }

    const confusers = this._count_one_bounce_confusers();
    const clutter = this._clutter_density(base_dir, 220.0, 30.0);
    const similar = this._similar_orientation_near_first_segment(base_dir, ev_base);

    const D_prob = 1.0 / Math.sqrt(Math.max(P_ang * P_chain, 1e-6));
    const bounce_factor = 1.0 + 0.35 * N + 0.06 * (N*N);
    const t_size = this.target.w;
    const target_factor = Math.pow((90.0 / Math.max(20.0, t_size)), 0.7);
    const path_factor = 1.0 + path_len / 2200.0;
    const confuser_factor = 1.0 + 0.20 * Math.atan(confusers / 3.0);
    const clutter_factor = 1.0 + 0.18 * Math.atan(clutter / 3.0);
    const similar_factor = 1.0 + 0.12 * Math.atan(similar / 2.0);

    let score = BASE_SCORE_SCALE * D_prob * bounce_factor * target_factor * path_factor * confuser_factor * clutter_factor * similar_factor;
    this.difficulty_score = clamp(score, 20.0, 6000.0);
  }

  _hits_target(dir_unit){
    const [,hit] = this._raycast_path(this.emitter, dir_unit, MAX_BOUNCES);
    return hit;
  }

  _aim_tolerance_bisect(base_dir, max_deg=20.0, eps_deg=0.05){
    const boundary = (sign)=>{
      let lo = 0.0, hi = max_deg;
      while (true){
        const ang = (Math.PI/180)*(sign*hi);
        const d = v_rot(base_dir, ang);
        if (!this._hits_target(d)) break;
        hi *= 1.25; if (hi > max_deg) break;
      }
      for (let i=0;i<20;i++){
        const mid = (lo + hi)/2;
        const d = v_rot(base_dir, (Math.PI/180)*(sign*mid));
        if (this._hits_target(d)) lo = mid; else hi = mid;
        if ((hi - lo) < eps_deg) break;
      }
      return lo;
    };
    return [boundary(+1), boundary(-1)];
  }

  _sensitivity_profile(base_dir, ev_base, delta_deg_start=0.4){
    const base_bounce = ev_base.filter(e=>e.type==="reflector").map(e=>[e.idx, e.u]);
    if (!base_bounce.length) return null;
    let delta_deg = delta_deg_start;
    for (let tries=0; tries<3; tries++){
      const dtheta = (Math.PI/180)*delta_deg;
      const [,hitp,, ev_p] = this._raycast_path(this.emitter, v_rot(base_dir, dtheta), MAX_BOUNCES, true);
      const [,hitm,, ev_m] = this._raycast_path(this.emitter, v_rot(base_dir, -dtheta), MAX_BOUNCES, true);
      if (!(hitp && hitm)){ delta_deg *= 0.5; continue; }
      const bp = ev_p.filter(e=>e.type==="reflector").map(e=>[e.idx, e.u]);
      const bm = ev_m.filter(e=>e.type==="reflector").map(e=>[e.idx, e.u]);
      if (bp.length !== base_bounce.length || bm.length !== base_bounce.length){ delta_deg *= 0.5; continue; }
      const seq_base = base_bounce.map(x=>x[0]);
      if (bp.map(x=>x[0]).join(",") !== seq_base.join(",") || bm.map(x=>x[0]).join(",") !== seq_base.join(",")){ delta_deg *= 0.5; continue; }
      const du_list = [], margins = [];
      for (let k=0;k<base_bounce.length;k++){
        const [,u0] = base_bounce[k];
        const [,up] = bp[k];
        const [,um] = bm[k];
        const du_dtheta = (up - um) / (2.0 * ((Math.PI/180)*delta_deg));
        const margin_u = Math.max(0.0, Math.min(u0, 1.0 - u0) - CORNER_TOL_FRAC);
        du_list.push(du_dtheta);
        margins.push(margin_u);
      }
      return [du_list, margins];
    }
    return null;
  }

  _count_one_bounce_confusers(near_ext_px=18.0){
    const E = this.emitter;
    const T = this.target.center();
    let count = 0;
    for (let idx=0; idx<this.reflectors.length; idx++){
      const r = this.reflectors[idx];
      const A = r.a, B = r.b;
      const AB_dir = r.direction();
      if (v_len(AB_dir) < 1e-6) continue;
      const n = v_perp(AB_dir);
      const AE = v_sub(E, A);
      const d_n = v_dot(AE, n);
      const E_mirror = v_sub(E, v_mul(n, 2.0 * d_n));
      const inter = line_line_intersection(A,B, T, E_mirror);
      if (!inter) continue;
      const [t_ab,,P] = inter;
      const L = v_dist(A,B);
      if (L < 1e-6) continue;
      if (0.0 <= t_ab && t_ab <= 1.0){
        // check path ordering
        const dir_in = v_norm(v_sub(P,E));
        let nearest_t = Infinity, nearest_idx = null;
        for (let j=0;j<this.reflectors.length;j++){
          const inter2 = ray_segment_intersection(E, dir_in, this.reflectors[j].a, this.reflectors[j].b);
          if (inter2){
            const [t2] = inter2;
            if (t2 < nearest_t){ nearest_t=t2; nearest_idx=j; }
          }
        }
        if (nearest_idx !== idx){ count++; continue; }
        const dir_out = v_norm(reflect(dir_in, r.normal()));
        const t_target = ray_aabb_intersection(P, dir_out, this.target.aabb());
        if (t_target === null){ count++; }
        else {
          let blocked = false;
          for (let j=0;j<this.reflectors.length;j++){
            const inter3 = ray_segment_intersection(P, dir_out, this.reflectors[j].a, this.reflectors[j].b);
            if (inter3){
              const [t3] = inter3;
              if (t3 < t_target){ blocked = true; break; }
            }
          }
          if (blocked) count++;
        }
      } else {
        const d_ext = t_ab < 0.0 ? Math.abs(t_ab)*L : Math.abs(t_ab-1.0)*L;
        if (d_ext <= near_ext_px) count++;
      }
    }
    return count;
  }

  _clutter_density(base_dir, radius=220.0, half_angle_deg=30.0){
    const E = this.emitter;
    const cos_thresh = Math.cos((Math.PI/180)*half_angle_deg);
    let score = 0.0;
    for (const r of this.reflectors){
      const mid = [(r.a[0]+r.b[0])*0.5, (r.a[1]+r.b[1])*0.5];
      const v_em = v_sub(mid, E);
      const d = v_len(v_em);
      if (d > radius || d < 1e-6) continue;
      const v_em_u = v_norm(v_em);
      const cosang = v_dot(v_em_u, base_dir);
      if (cosang < cos_thresh) continue;
      let w = (1.0 - d/radius) * ((cosang - cos_thresh)/(1.0 - cos_thresh));
      const seg_len = v_dist(r.a,r.b);
      score += w * (0.5 + 0.5 * Math.min(1.0, seg_len/200.0));
    }
    return score;
  }

  _similar_orientation_near_first_segment(base_dir, ev_base){
    const first_refl = ev_base.find(e=>e.type==="reflector");
    if (!first_refl) return 0.0;
    const idx_first = first_refl.idx;
    const r_sol = this.reflectors[idx_first];
    const sol_angle = angle_of(r_sol.direction());
    const first_hit_point = first_refl.point;
    const E = this.emitter;
    let count = 0.0;
    for (let i=0;i<this.reflectors.length;i++){
      const r = this.reflectors[i];
      if (!r.is_noise && i === idx_first) continue;
      const a_r = angle_of(r.direction());
      const diff = Math.min(angle_diff(a_r, sol_angle), angle_diff(a_r + Math.PI, sol_angle));
      if (diff > (Math.PI/180)*12.0) continue;
      const d = point_to_line_distance([(r.a[0]+r.b[0])*0.5, (r.a[1]+r.b[1])*0.5], E, first_hit_point);
      const w = Math.exp(-d / 150.0);
      count += w;
    }
    return count;
  }
}

// -------------------- Viewport --------------------
class Viewport {
  constructor(canvas){
    this.canvas = canvas;
    this.update();
  }
  update(){
    const w = this.canvas.width, h = this.canvas.height;
    this.scale = Math.min(w / VIRTUAL_W, h / VIRTUAL_H);
    this.offset = [(w - VIRTUAL_W * this.scale) / 2, (h - VIRTUAL_H * this.scale) / 2];
  }
  toScreen(p){ return [this.offset[0] + p[0]*this.scale, this.offset[1] + p[1]*this.scale]; }
  toVirtual(s){ return [(s[0]-this.offset[0])/this.scale, (s[1]-this.offset[1])/this.scale]; }
}

// -------------------- Game --------------------
class Game {
  constructor(canvas){
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.vp = new Viewport(canvas);

    this.rng = new RNG();
    this.resetGame();

    this._bindEvents();
    this._startLoop();
  }

  resetGame(){
    this.state = "menu"; // menu, playing, round_complete, game_over
    this.round_num = 1;
    this.score = 0;
    this.high_score = parseInt(localStorage.getItem(HIGH_SCORE_KEY) || "0", 10);
    this.timer = ROUND_TIME;
    this.level = null;

    this.dragging = false;
    this.drag_start_v = null;
    this.drag_curr_v = null;

    this.beam_active = false;
    this.beam_points = [];
    this.beam_seg_index = 0;
    this.beam_seg_pos = 0.0;
    this.beam_result = null;

    this.points_awarded = 0;
    this.round_message_timer = 0.0;
  }

  startRound(){
    this.level = new Level(this.round_num, this.rng);
    this.timer = ROUND_TIME;
    this.dragging = false;
    this.beam_active = false;
    this.beam_points = [];
    this.beam_result = null;
    this.points_awarded = 0;
    this.round_message_timer = 0.0;
    this.state = "playing";
  }

  _bindEvents(){
    const dpr = window.devicePixelRatio || 1;
    const resize = ()=>{
      // Keep canvas CSS fixed; adjust internal resolution to DPR
      const rect = this.canvas.getBoundingClientRect();
      const w = Math.max(2, Math.floor(rect.width * dpr));
      const h = Math.max(2, Math.floor(rect.height * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h){
        this.canvas.width = w; this.canvas.height = h;
        this.ctx.setTransform(1,0,0,1,0,0);
        this.ctx.scale(dpr, dpr); // scale text crisp? We'll draw with CSS pixels, so no
      }
      // We draw in CSS pixels; for simplicity treat canvas as CSS space
      // Reset to match CSS pixels
      this.ctx.setTransform(1,0,0,1,0,0);
      this.vp.update();
      this._draw(); // immediate update
    };
    const cssResize = ()=>{
      // Ensure we're drawing in CSS pixel coordinate space
      // We'll set canvas width/height = CSS width/height for simplicity
      // Note: We already set width/height in HTML. We rely on CSS scaling; keep transform unity.
      this.vp.update();
      this._draw();
    };

    // Resize on load and on window resize (no DPR scaling complexity)
    window.addEventListener("resize", cssResize);
    setTimeout(cssResize, 0);

    const getPos = (ev)=>{
      if (ev.touches && ev.touches.length){
        const t = ev.touches[0];
        const rect = this.canvas.getBoundingClientRect();
        return [t.clientX - rect.left, t.clientY - rect.top];
      } else {
        const rect = this.canvas.getBoundingClientRect();
        return [ev.clientX - rect.left, ev.clientY - rect.top];
      }
    };

    const onDown = (ev)=>{
      ev.preventDefault();
      if (this.state === "menu"){ this.startRound(); return; }
      if (this.state === "game_over"){ this.resetGame(); return; }
      if (this.state !== "playing") return;
      if (this.beam_active) return;
      const pos = getPos(ev);
      const vpos = this.vp.toVirtual(pos);
      this.dragging = true;
      this.drag_start_v = this.level.emitter.slice();
      this.drag_curr_v = vpos;
    };
    const onMove = (ev)=>{
      if (!this.dragging) return;
      const pos = getPos(ev);
      this.drag_curr_v = this.vp.toVirtual(pos);
    };
    const onUp = (ev)=>{
      if (!this.dragging) return;
      this.dragging = false;
      if (this.state !== "playing" || this.beam_active) return;
      const pos = getPos(ev);
      const end_v = this.vp.toVirtual(pos);
      const dir_vec = v_sub(end_v, this.level.emitter);
      if (v_len(dir_vec) < 5.0) return;
      const dir_unit = v_norm(dir_vec);
      this._fireBeam(dir_unit);
    };

    this.canvas.addEventListener("mousedown", onDown);
    this.canvas.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    this.canvas.addEventListener("touchstart", onDown, {passive:false});
    this.canvas.addEventListener("touchmove", onMove, {passive:false});
    this.canvas.addEventListener("touchend", onUp);
  }

  _fireBeam(dir_unit){
    const [pts, hit, reason] = this.level._raycast_path(this.level.emitter, dir_unit, MAX_BOUNCES);
    this.beam_points = pts;
    this.beam_result = hit ? "hit" : reason;
    this.beam_active = true;
    this.beam_seg_index = 0;
    this.beam_seg_pos = 0.0;
  }

  _update(dt){
    if (this.state === "menu") return;

    if (this.state === "playing"){
      if (!this.beam_active){
        this.timer -= dt;
        if (this.timer <= 0){
          this.timer = 0;
          this.state = "game_over";
          if (this.score > this.high_score){
            this.high_score = this.score;
            localStorage.setItem(HIGH_SCORE_KEY, String(this.high_score));
          }
          return;
        }
      }
      if (this.beam_active) this._updateBeamAnimation(dt);
    } else if (this.state === "round_complete"){
      this.round_message_timer -= dt;
      if (this.round_message_timer <= 0){
        this.round_num += 1;
        this.startRound();
      }
    }
  }

  _updateBeamAnimation(dt){
    while (dt > 0 && this.beam_active){
      if (this.beam_seg_index >= this.beam_points.length - 1){
        this._finishBeam();
        break;
      }
      const p0 = this.beam_points[this.beam_seg_index];
      const p1 = this.beam_points[this.beam_seg_index+1];
      const seg_vec = v_sub(p1, p0);
      const seg_len = Math.max(1e-6, v_len(seg_vec));
      const remaining = seg_len - this.beam_seg_pos;
      const advance = BEAM_SPEED * dt;
      if (advance < remaining){
        this.beam_seg_pos += advance; dt = 0.0;
      } else {
        dt -= remaining / BEAM_SPEED;
        this.beam_seg_index += 1;
        this.beam_seg_pos = 0.0;
      }
    }
  }

  _finishBeam(){
    this.beam_active = false;
    if (this.beam_result === "hit"){
      const D = this.level.difficulty_score;
      const time_mult = 1.0 + TIME_BONUS_FACTOR * (Math.max(0.0, this.timer) / ROUND_TIME);
      const points = Math.round(D * time_mult);
      this.score += points;
      this.points_awarded = points;
      this.round_message_timer = 1.0;
      this.state = "round_complete";
    }
  }

  _draw(){
    const ctx = this.ctx;
    const vp = this.vp;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;

    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = rgb(COLOR_BG);
    ctx.fillRect(0,0,w,h);

    // Playfield outline
    ctx.strokeStyle = rgb(COLOR_BORDER);
    ctx.lineWidth = 2;
    const origin = vp.toScreen([0,0]);
    ctx.strokeRect(origin[0], origin[1], VIRTUAL_W*vp.scale, VIRTUAL_H*vp.scale);

    if ((this.state === "playing" || this.state === "round_complete") && this.level){
      // Reflectors
      for (const r of this.level.reflectors){
        let color = COLOR_REFLECTOR;
        if (r.is_noise && !r.is_blocker) color = COLOR_NOISE_REFLECTOR;
        if (r.is_blocker) color = COLOR_BLOCKER;
        ctx.strokeStyle = rgb(color);
        ctx.lineWidth = 3;
        const a = vp.toScreen(r.a), b = vp.toScreen(r.b);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }

      // Target
      const t = this.level.target;
      const topLeft = vp.toScreen([t.x, t.y]);
      ctx.fillStyle = rgb(COLOR_TARGET);
      ctx.beginPath();
      // rounded rect
      const rx = Math.max(2, 4), ry = rx;
      const tw = t.w * vp.scale, th = t.h * vp.scale;
      roundRect(ctx, topLeft[0], topLeft[1], tw, th, rx);
      ctx.fill();

      // Emitter
      const e = vp.toScreen(this.level.emitter);
      ctx.fillStyle = rgb(COLOR_EMITTER);
      ctx.beginPath();
      ctx.arc(e[0], e[1], Math.max(3, EMITTER_RADIUS * vp.scale), 0, Math.PI*2);
      ctx.fill();

      // Predictive first-bounce
      if (this.dragging && this.drag_curr_v) this._draw_predictive();

      // Beam animation
      if (this.beam_active) this._draw_beam();
    }

    // HUD
    this._drawHUD();

    if (this.state === "menu") this._drawMenu();
    else if (this.state === "round_complete") this._drawRoundComplete();
    else if (this.state === "game_over") this._drawGameOver();
  }

  _draw_predictive(){
    const origin = this.level.emitter;
    const vp = this.vp;
    const dir_unit = v_norm(v_sub(this.drag_curr_v, origin));
    if (v_len(dir_unit) <= 0) return;

    let nearest_t = Infinity, nearest_point = null, nearest_reflector_idx = null, nearest_is_target = false;

    for (let idx=0; idx<this.level.reflectors.length; idx++){
      const r = this.level.reflectors[idx];
      const inter = ray_segment_intersection(origin, dir_unit, r.a, r.b);
      if (inter){
        const [t,,p] = inter;
        if (t < nearest_t){
          nearest_t = t; nearest_point = p; nearest_reflector_idx = idx; nearest_is_target = false;
        }
      }
    }
    const t_target = ray_aabb_intersection(origin, dir_unit, this.level.target.aabb());
    if (t_target !== null && t_target < nearest_t){
      nearest_t = t_target;
      nearest_point = v_add(origin, v_mul(dir_unit, t_target));
      nearest_reflector_idx = null;
      nearest_is_target = true;
    }
    const bounds_t = ray_aabb_exit_distance_from_inside(origin, dir_unit, this.level.bounds);
    if (bounds_t !== null && bounds_t < nearest_t){
      nearest_t = bounds_t;
      nearest_point = v_add(origin, v_mul(dir_unit, bounds_t));
      nearest_reflector_idx = null;
      nearest_is_target = false;
    }

    const p0 = vp.toScreen(origin);
    const ctx = this.ctx;
    ctx.strokeStyle = rgb(COLOR_BEAM);
    ctx.lineWidth = 2;

    if (!nearest_point){
      const p1 = vp.toScreen(v_add(origin, v_mul(dir_unit, 600)));
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      return;
    }
    const p1 = vp.toScreen(nearest_point);
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();

    if (nearest_is_target || nearest_reflector_idx === null) return;

    const refl = this.level.reflectors[nearest_reflector_idx];
    const n = refl.normal();
    const new_dir = v_norm(reflect(dir_unit, n));
    const p2 = vp.toScreen(v_add(nearest_point, v_mul(new_dir, 140)));
    ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
  }

  _draw_beam(){
    const ctx = this.ctx, vp = this.vp;
    ctx.strokeStyle = rgb(COLOR_BEAM);
    ctx.lineWidth = 3;

    for (let i=0; i<this.beam_seg_index; i++){
      const p0 = vp.toScreen(this.beam_points[i]);
      const p1 = vp.toScreen(this.beam_points[i+1]);
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    }
    if (this.beam_seg_index < this.beam_points.length - 1){
      const p0v = this.beam_points[this.beam_seg_index];
      const p1v = this.beam_points[this.beam_seg_index+1];
      const seg_vec = v_sub(p1v, p0v);
      const seg_len = Math.max(1e-6, v_len(seg_vec));
      const t = clamp(this.beam_seg_pos / seg_len, 0, 1);
      const curr = v_add(p0v, v_mul(seg_vec, t));
      const p0 = vp.toScreen(p0v);
      const pc = vp.toScreen(curr);
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(pc[0], pc[1]); ctx.stroke();
    }
  }

  _drawHUD(){
    const ctx = this.ctx;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;

    ctx.textBaseline = "top";
    ctx.font = "16px Arial";
    // Score (left)
    ctx.fillStyle = rgb(COLOR_TEXT);
    ctx.fillText(`Score: ${this.score}`, 16, 12);

    // High Score (right)
    const hs = `High: ${this.high_score}`;
    const hsWidth = ctx.measureText(hs).width;
    ctx.fillText(hs, w - hsWidth - 16, 12);

    // Timer (center)
    const t = Math.max(0, Math.floor(this.timer));
    ctx.fillStyle = t < 10 ? rgb(COLOR_TIMER_WARN) : rgb(COLOR_TEXT);
    const timerStr = `${t}s`;
    const tw = ctx.measureText(timerStr).width;
    ctx.fillText(timerStr, (w - tw)/2, 12);

    // Round (bottom-center)
    ctx.fillStyle = rgb(COLOR_TEXT_DIM);
    const rs = `Round ${this.round_num}`;
    const rsw = ctx.measureText(rs).width;
    ctx.fillText(rs, (w - rsw)/2, h - 28);

    // Difficulty info (bottom-left)
    if (this.level && (this.state === "playing" || this.state === "round_complete")){
      ctx.fillStyle = rgb(COLOR_TEXT_DIM);
      const diff = Math.round(this.level.difficulty_score);
      const tol = this.level.aim_tolerance_deg;
      ctx.fillText(`Difficulty: ${diff}  (Aim ±${tol.toFixed(1)}°)`, 16, h - 28);
    }
  }

  _drawMenu(){
    const ctx = this.ctx;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = rgb(COLOR_TEXT);

    ctx.font = "42px Arial";
    ctx.fillText("RayTrace", w/2, h/2 - 110);

    ctx.font = "20px Arial";
    ctx.fillStyle = rgb(COLOR_TEXT_DIM);
    ctx.fillText(`High Score: ${this.high_score}`, w/2, h/2 - 50);

    ctx.font = "28px Arial";
    ctx.fillText("Click to Start", w/2, h/2 + 10);

    ctx.textAlign = "left";
  }

  _drawRoundComplete(){
    const ctx = this.ctx;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.font = "42px Arial"; ctx.fillStyle = "rgb(120,255,160)";
    ctx.fillText("Success!", w/2, h/2 - 40);
    ctx.font = "28px Arial"; ctx.fillStyle = "rgb(220,255,180)";
    ctx.fillText(`+${this.points_awarded}`, w/2, h/2 + 10);
    ctx.textAlign = "left";
  }

  _drawGameOver(){
    const ctx = this.ctx;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.font = "42px Arial"; ctx.fillStyle = "rgb(255,120,120)";
    ctx.fillText("Time's Up!", w/2, h/2 - 80);
    ctx.font = "28px Arial"; ctx.fillStyle = rgb(COLOR_TEXT);
    ctx.fillText(`Final Score: ${this.score}`, w/2, h/2 - 30);
    const newhs = this.score > this.high_score;
    if (newhs){
      ctx.fillStyle = "rgb(255,230,120)"; ctx.fillText("New High Score!", w/2, h/2 + 10);
    }
    ctx.fillStyle = rgb(COLOR_TEXT_DIM);
    ctx.fillText("Click to Replay", w/2, h/2 + 60);
    ctx.textAlign = "left";
  }

  _startLoop(){
    let last = performance.now();
    const step = (now)=>{
      const dt = Math.min(0.1, (now - last)/1000);
      last = now;
      this._update(dt);
      this._draw();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

// Rounded rect helper
function roundRect(ctx, x, y, w, h, r){
  const rr = Math.min(r, Math.min(w, h)/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y,   x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x,   y+h, rr);
  ctx.arcTo(x,   y+h, x,   y,   rr);
  ctx.arcTo(x,   y,   x+w, y,   rr);
  ctx.closePath();
}

// Bootstrap
const canvas = document.getElementById("game");
new Game(canvas);
