// Tiny in-browser Vulpin interpreter powering the site playground.
// Mirrors Vulpin 1.x (the C VM) as documented in the upstream README:
// G/g/P output (with multiline via command + '''), K typed input,
// direct assignment (x=10) plus the legacy E form, A add-assign,
// S string replace, D as delay (numbers) or variable delete ("name"),
// o / os.system (echo only in this sandbox), ?/:/; if-else with
// inline commands, @/& while, O/& for-range (with negative step),
// W/V/N/Z switch, J/L jumps (incl. "? cond J label"), F/R/~ functions,
// T/C/Y try-catch, U imports (math, random, os in the sandbox),
// Lists/Dicts/Sets with `in` and len/push/pop/keys/values,
// string shortcuts .U .L .S .T .C, comparison shorthands m (>=) / l (<=),
// `$var` references, inline `;` commands, and integer division that
// truncates toward zero.
//
// Deliberate sandbox differences from the CLI: D (delay) does not sleep,
// and os.system only understands `echo <text>`.

// Numbers written with a decimal point (7.0) keep "floatness" so that
// 7.0/2 = 3.5 while 7/2 = 3, though JS itself cannot tell 7.0 from 7.
class VFloat extends Number {}

export class Vulpin {
  constructor() {
    this.reset()
  }

  reset() {
    this.env = Object.create(null)
    this.output = []
    this.ml = []
    this.modules = {}
    this.retval = undefined
    this.builtins = {
      abs: Math.abs,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      sqrt: Math.sqrt,
      pow: Math.pow,
      len: (x) => {
        if (x instanceof Map || x instanceof Set) return x.size
        if (Array.isArray(x)) return x.length
        return String(x).length
      },
      push: (l, v) => {
        if (!Array.isArray(l)) throw new Error('push needs a List')
        l.push(v)
        return ''
      },
      pop: (l) => {
        if (!Array.isArray(l) || l.length === 0) throw new Error('pop from empty List')
        return l.pop()
      },
      keys: (d) => {
        if (d instanceof Map) return Array.from(d.keys())
        if (Array.isArray(d)) return d.map((_, i) => i)
        throw new Error('keys needs a Dict')
      },
      values: (d) => {
        if (d instanceof Map) return Array.from(d.values())
        throw new Error('values needs a Dict')
      },
      upper: (s) => String(s).toUpperCase(),
      lower: (s) => String(s).toLowerCase(),
      title: (s) => String(s).replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase()),
      char: (n) => String.fromCharCode(n),
      ord: (c) => (typeof c === 'string' && c.length ? c.charCodeAt(0) : c),
      rand: (n) => Math.floor(Math.random() * (n || 100)),
      min: Math.min,
      max: Math.max,
    }
  }

  /* ---------- preprocessing ---------- */

  // Turns the physical source into "logical command slots":
  // - `#` comments are stripped (outside quotes)
  // - inline `;` splits a line into multiple commands
  // - a line starting with ':' (else / else-if) becomes a bare ':' slot
  //   followed by the rest as its own slots
  // - command + ''' opens a multi-line text block consumed below
  preprocess(source) {
    const phys = source.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''))
    this.ml = []
    const out = []
    for (let i = 0; i < phys.length; i++) {
      const raw = phys[i]
      const t = raw.replace(/^\s+/, '')
      const multi = t.match(/^([GgPp-]?)\s*'''$/)
      if (multi) {
        const body = []
        let j = i + 1
        for (; j < phys.length; j++) {
          if (phys[j].trim() === "'''") break
          body.push(phys[j])
        }
        i = j
        const idx = this.ml.push(body.join('\n')) - 1
        out.push('\x01ML' + idx)
        continue
      }
      if (t === '' || t[0] === '#') { out.push(''); continue }
      for (const part of this.splitCommands(t)) out.push(part)
    }
    return out
  }

  splitCommands(line) {
    // strip a trailing # comment (outside quotes)
    let s = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"' && line[i - 1] !== '\\') q = !q
      if (ch === '#' && !q) break
      s += ch
    }
    s = s.replace(/\s+$/, '')
    if (s === ':' || s === ';' || s === '') return [s]
    // ": cmd" / ":? cond cmd" — the ':' is its own slot, the rest follows
    if (s[0] === ':' && s.length > 1) return [':', ...this.splitCommands(s.replace(/^\s*:\s*/, ''))]
    if (!s.includes(';')) return [s]
    const parts = []
    let cur = ''
    q = false
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      if (ch === '"' && s[i - 1] !== '\\') q = !q
      if (ch === ';' && !q) {
        if (cur.trim()) parts.push(...this.splitCommands(cur.trim()))
        cur = ''
      } else cur += ch
    }
    if (cur.trim()) parts.push(...this.splitCommands(cur.trim()))
    return parts.length ? parts : ['']
  }

  /* ---------- execution ---------- */

  run(source, maxSteps = 40000, freshEnv = true) {
    if (freshEnv) this.reset()
    const prevLines = Array.isArray(source) ? source : null
    const src = prevLines || this.preprocess(source)
    let pc = 0
    let steps = 0
    const started = Date.now()
    try {
      while (pc < src.length) {
        if (++steps > maxSteps) throw new Error('sandbox: loop bound hit')
        pc = this.step(src, pc)
      }
      return { ok: true, ms: Date.now() - started }
    } catch (e) {
      if (e.message === 'QUIT::') return { ok: true, quit: true, ms: Date.now() - started }
      return { ok: false, ms: started ? Date.now() - started : 0, error: e.message }
    }
  }

  step(src, pc) {
    const raw = src[pc]
    const line = raw.replace(/^\s+/, '')
    const cmd = line[0]
    const arg = line.slice(1).trim()

    switch (cmd) {
      case '':
      case '#':
        return pc + 1

      case '\x01': { // preprocessed multi-line text block
        const m = line.slice(1).match(/^ML(\d+)$/)
        this.println(this.ml[Number(m[1])] ?? '')
        return pc + 1
      }

      case 'G':
        this.println(this.evalExpr(arg))
        return pc + 1

      case 'g':
      case 'P':
        this.print(this.evalExpr(arg))
        return pc + 1

      case 'E': {
        const m = arg.match(/^([A-Za-z_]\w*)\s*(?:=\s*)?([\s\S]*)$/)
        if (!m || !m[1]) throw new Error('E needs a variable name')
        this.env[m[1]] = this.evalExpr(m[2])
        return pc + 1
      }

      case 'A': {
        const m = arg.match(/^(?:([A-Za-z_]\w*)|"([^"]*)")\s*([\s\S]*)$/)
        if (!m || (!m[1] && !m[2])) throw new Error('A needs a variable name')
        const name = m[1] || m[2]
        const cur = this.env[name] === undefined ? 0 : this.env[name]
        this.env[name] = cur + this.evalExpr(m[3])
        return pc + 1
      }

      case 'S': {
        const m = arg.match(/^"([^"]*)"\s*"([^"]*)"\s*"([^"]*)"$/)
        if (!m) throw new Error('S format: S"var""from""to"')
        const name = m[1]
        const cur = this.env[name] === undefined ? '' : this.env[name]
        this.env[name] = String(cur).split(m[2]).join(m[3])
        return pc + 1
      }

      case 'D': {
        const del = arg.match(/^"([^"]*)"$/)
        if (del) { delete this.env[del[1]]; return pc + 1 } // D"var" deletes
        return pc + 1 // D <seconds> delays on the real CLI; skipped here
      }

      case 'K': {
        const m = arg.match(/^([A-Za-z_]\w*)\s*(?:"([^"]*)")?\s*"?([IFNLWEUAP])?"?$/)
        if (!m || !m[1]) throw new Error('K needs a variable name')
        let rawIn = ''
        if (typeof prompt === 'function') {
          const ans = prompt(m[2] === undefined || m[2] === '' ? 'input: ' : m[2])
          if (ans !== null) rawIn = ans
        }
        this.env[m[1]] = this.coerceInput(rawIn, m[3])
        return pc + 1
      }

      case 'Q':
        throw new Error('QUIT::')

      case '?': {
        // one-line jump: ? cond J label
        const jm = arg.match(/^(.*?)\s+J\s+([A-Za-z_]\w*)$/)
        if (jm) {
          if (this.truthy(this.evalExpr(jm[1]))) return this.findLabel(src, jm[2])
          return pc + 1
        }
        // one-line action: ? cond G expr  (also g / P / o)
        const act = this.tryParseInlineAction(arg)
        if (act) {
          if (act.truth) this.execInlineAction(act.rest)
          return pc + 1
        }
        return this.runChain(src, pc)
      }

      case ':': // reached from inside a running branch: skip to the chain's ';'
        return this.skipTo(src, pc, ';')

      case ';':
        return pc + 1

      case '@': {
        const cond = arg === '1' || this.truthy(this.evalExpr(arg))
        if (cond) return pc + 1
        return this.findLoopEnd(src, pc) + 1
      }

      case '&':
        return this.findLoopStart(src, pc)

      case 'O': { // O var start end [step] ... &
        const parts = arg.split(/\s+/).filter(Boolean)
        const [vname, startT, endT] = parts
        if (!/^[A-Za-z_]\w*$/.test(vname || '')) throw new Error('O needs a variable')
        const start = this.num(this.evalExpr(startT))
        const end = this.num(this.evalExpr(endT))
        const step = parts[3] ? Math.abs(this.num(this.evalExpr(parts[3]))) || 1 : 1
        const endIdx = this.findLoopEnd(src, pc)
        const body = src.slice(pc + 1, endIdx).join('\n')
        const dir = start <= end ? 1 : -1
        // the end value is exclusive, as documented: O i 0 5 → 0,1,2,3,4
        for (let v = start; dir === 1 ? v < end : v > end; v += dir * step) {
          this.env[vname] = v
          const out = this.runSub(body, 2000)
          if (!out.ok) throw new Error('in loop: ' + out.error)
        }
        return endIdx + 1
      }

      case 'W': {
        const target = this.evalExpr(arg)
        const endIdx = this.findSwitchEnd(src, pc)
        for (let i = pc + 1; i < endIdx; i++) {
          const c = src[i].trim()
          const ch = c[0]
          if (ch === 'V') {
            const cv = this.evalExpr(c.slice(1).trim())
            if (this.eq(cv, target)) {
              let j = i + 1
              for (; j < endIdx; j++) {
                const cc = src[j].trim()[0]
                if (cc === 'V' || cc === 'N' || cc === 'Z') break
              }
              return this.runBlock(src, i + 1, j, endIdx + 1, 'switch case')
            }
            i++
            continue
          }
          if (ch === 'N') {
            return this.runBlock(src, i + 1, endIdx, endIdx + 1, 'switch default')
          }
        }
        return endIdx + 1
      }

      case 'V':
      case 'N':
      case 'Z':
        return pc + 1 // only meaningful inside W

      case 'F': {
        const m = arg.match(/^([A-Za-z_]\w*)\s*(?:\(\s*((?:[A-Za-z_]\w*\s*,?\s*)*)\s*\))?\s*$/)
        if (!m || !m[1]) throw new Error('F needs a name (F name(a, b))')
        const params = (m[2] || '').split(',').map((s) => s.trim()).filter(Boolean)
        let i = pc + 1
        for (; i < src.length; i++) if (src[i].trim()[0] === '~') break
        this.env['fn:' + m[1]] = { params, body: src.slice(pc + 1, i) }
        return i + 1
      }

      case 'R':
        this.retval = this.evalExpr(arg)
        throw new Error('::return::')

      case 'Y':
        return pc + 1 // only meaningful inside T

      case 'T': {
        const endIdx = this.findTryEnd(src, pc)
        let ci = -1, ename = 'err'
        for (let j = pc + 1; j < endIdx; j++) {
          const c = src[j].trim()
          if (c[0] === 'C') {
            const m = c.slice(1).trim().match(/^"([A-Za-z_]\w*)"$/)
            if (m) { ci = j; ename = m[1] }
            break
          }
        }
        const tryBody = src.slice(pc + 1, ci >= 0 ? ci : endIdx).join('\n')
        const catchBody = ci >= 0 ? src.slice(ci + 1, endIdx).join('\n') : ''
        const out = this.runSub(tryBody, 4000)
        if (!out.ok) {
          this.env[ename] = out.error
          const c2 = this.runSub(catchBody, 4000)
          if (!c2.ok && c2.error !== 'QUIT::') throw new Error('in catch: ' + c2.error)
        }
        return endIdx + 1
      }

      case 'C':
      case 'L':
      case '~':
        return pc + 1

      case 'J': {
        let i
        for (i = 0; i < src.length; i++) {
          const m = src[i].trim().match(/^L\s+([A-Za-z_]\w*)\s*$/)
          if (m && m[1] === arg) break
        }
        return i
      }

      case 'U': {
        const nm = (arg.match(/"([^"]*)"/) || [, arg.trim()])[1] || arg.trim()
        this.importModule(String(nm))
        return pc + 1
      }

      case 'o': // lowercase o: shell command (echo only in this sandbox)
        this.runSystem(arg)
        return pc + 1

      default:
        return this.execStatement(line, src, pc)
    }
  }

  /* ---------- statements that fall outside single letters ---------- */

  execStatement(line, src, pc) {
    // direct assignment: x = 10, name = "Vul", l[0] = 99, d["c"] = 3
    const am = line.match(/^([A-Za-z_]\w*)\s*((?:\[[^\]=]*\]\s*)*)=(?!=)\s*([\s\S]*)$/)
    if (am) {
      const name = am[1]
      const value = this.evalExpr(am[3])
      const idxs = am[2].trim() ? am[2].trim().match(/\[([^\]=]*)\]/g) : null
      if (idxs) {
        let obj = this.env[name]
        if (!obj || !(obj instanceof Map || Array.isArray(obj))) throw new Error(name + ' is not a List or Dict')
        for (let k = 0; k < idxs.length - 1; k++) obj = this.indexGet(obj, this.evalExpr(idxs[k].slice(1, -1)))
        this.indexSet(obj, this.evalExpr(idxs[idxs.length - 1].slice(1, -1)), value)
      } else {
        this.env[name] = value
      }
      return pc + 1
    }
    // bare expression (function call etc.)
    const v = this.evalExpr(line)
    if (v !== '' && v !== undefined) this.println(v)
    return pc + 1
  }

  /* ---------- if / else-if chains ---------- */

  // Sibling-branch model, matching the README style:
  //   ? cond  → branch guard (also ":? cond cmd" one-liners after a ':')
  //   :       → separator; the next '?' slot / content starts the next branch
  //   ;       → chain end
  runChain(src, pc) {
    const branches = [{ guard: src[pc].slice(1).trim(), inline: null, truth: undefined, from: pc + 1 }]
    let pending = false // a ':' was seen; next guard/content opens the next branch
    let endIdx = src.length
    for (let i = pc + 1; i < src.length; i++) {
      const t = src[i].trim()
      const c = t[0]
      const last = branches[branches.length - 1]
      if (c === '?') {
        const rest = t.slice(1).trim()
        const det = this.detectInline(rest)
        if (!pending && last.to === undefined) last.to = i
        branches.push({ guard: det ? det.cond : rest, inline: det, truth: det ? det.truth : undefined, from: i + 1 })
        pending = false
      } else if (c === ':') {
        if (last.to === undefined) last.to = i
        pending = true
      } else if (c === ';') {
        if (last.to === undefined) last.to = i
        endIdx = i + 1
        break
      } else if (pending) {
        branches.push({ guard: null, inline: null, truth: undefined, from: i })
        pending = false
      }
    }
    const lastB = branches[branches.length - 1]
    if (lastB.to === undefined) lastB.to = endIdx

    for (const br of branches) {
      let cond = true
      if (br.guard !== null) cond = br.truth !== undefined ? br.truth : this.truthy(this.evalExpr(br.guard))
      if (!cond) continue
      if (br.inline) {
        if (br.inline.kind === 'J') return this.findLabel(src, br.inline.label)
        this.execInlineAction(br.inline.rest)
        return endIdx
      }
      if (br.to > br.from) this.runBlock(src, br.from, br.to, endIdx, 'if branch')
      return endIdx
    }
    return endIdx
  }

  // Detects "? cond J label" and "? cond <cmd>" one-liners.
  // Returns { kind, cond, rest } or null.
  detectInline(arg) {
    const jm = arg.match(/^(.*\S)\s+J\s+([A-Za-z_]\w*)$/)
    if (jm) return { kind: 'J', cond: jm[1], label: jm[2] }
    const act = this.tryParseInlineAction(arg)
    if (act) return { kind: 'act', cond: act.cond, rest: act.rest, truth: act.truth }
    return null
  }

  tryParseInlineAction(arg) {
    if (!/\s/.test(arg)) return null
    for (let i = 0; i < arg.length; i++) {
      if (arg[i] !== ' ') continue
      const prefix = arg.slice(0, i)
      const rest = arg.slice(i + 1).replace(/^\s+/, '')
      if (!/^[GgPo]/.test(rest)) continue
      try {
        const v = this.evalExpr(prefix)
        return { cond: prefix, rest, truth: this.truthy(v) }
      } catch (e) { /* not a clean split; try the next space */ }
    }
    return null
  }

  execInlineAction(rest) {
    const c = rest[0]
    const rarg = rest.slice(1)
    if (c === 'G') this.println(this.evalExpr(rarg))
    else if (c === 'g' || c === 'P') this.print(this.evalExpr(rarg))
    else if (c === 'o') this.runSystem(rarg)
  }

  runSystem(arg) {
    const m = String(arg).match(/"([^"]*)"/)
    const cmdline = m ? m[1] : String(arg).trim()
    if (/^echo\s/.test(cmdline)) this.println(cmdline.replace(/^echo\s+/, ''))
    // other shell commands cannot run in the browser sandbox — ignored
  }

  importModule(name) {
    if (this.modules[name]) return
    if (name === 'math') {
      this.modules.math = {
        sqrt: Math.sqrt, pow: Math.pow, abs: Math.abs,
        floor: Math.floor, ceil: Math.ceil, round: Math.round,
        pi: Math.PI, e: Math.E,
      }
    } else if (name === 'random') {
      this.modules.random = {
        randint: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
        rand: () => Math.random(),
        randrange: (a, b) => a + Math.floor(Math.random() * (b - a)),
        choice: (l) => (Array.isArray(l) ? l[Math.floor(Math.random() * l.length)] : ''),
      }
    } else if (name === 'os') {
      this.modules.os = {
        name: 'browser',
        getcwd: () => '/',
        system: (cmd) => this.runSystem(String(cmd)),
      }
    } else {
      throw new Error('module ' + name + ' is not available in the browser sandbox')
    }
  }

  /* ---------- block scans ---------- */

  skipTo(src, pc, target) {
    let depth = 0
    let i = pc + 1
    for (; i < src.length; i++) {
      const c = src[i].trim()[0]
      if (c === '?') depth++
      else if (c === target) {
        if (depth === 0) return i + 1
        depth--
      }
    }
    return i
  }

  findLoopEnd(src, pc) {
    let depth = 1
    let i = pc + 1
    for (; i < src.length; i++) {
      const c = src[i].trim()[0]
      if (c === '@' || c === 'O') depth++
      else if (c === '&' && --depth === 0) break
    }
    return i
  }

  findLabel(src, label) {
    for (let i = 0; i < src.length; i++) {
      const m = src[i].trim().match(/^L\s+([A-Za-z_]\w*)\s*$/)
      if (m && m[1] === label) return i
    }
    return src.length
  }

  findLoopStart(src, pc) {
    let depth = 1
    let i = pc - 1
    for (; i >= 0; i--) {
      const c = src[i].trim()[0]
      if (c === '&') depth++
      else if ((c === '@' || c === 'O') && --depth === 0) break
    }
    return i
  }

  findSwitchEnd(src, pc) {
    let depth = 1
    let i = pc + 1
    for (; i < src.length; i++) {
      const c = src[i].trim()[0]
      if (c === 'W') depth++
      else if (c === 'Z' && --depth === 0) break
    }
    return i
  }

  findTryEnd(src, pc) {
    let depth = 1
    let i = pc + 1
    for (; i < src.length; i++) {
      const c = src[i].trim()[0]
      if (c === 'T') depth++
      else if (c === 'Y' && --depth === 0) break
    }
    return i
  }

  // runs a slice of preprocessed slots in a sub-shell, sharing env/output
  runSub(bodyText, maxSteps) {
    const sub = new Vulpin()
    sub.env = this.env
    sub.builtins = this.builtins
    sub.ml = this.ml
    sub.modules = this.modules
    const out = sub.run(bodyText, maxSteps, false)
    if (out.ok && out.quit) { this.output.push(...sub.output); throw new Error('QUIT::') }
    if (!out.ok && out.error === '::return::') {
      this.output.push(...sub.output)
      if (sub.retval !== undefined) this.retval = sub.retval
      throw new Error('::return::')
    }
    if (sub.retval !== undefined) this.retval = sub.retval
    this.output.push(...sub.output)
    return out
  }

  runBlock(src, from, to, retPc, label) {
    const sub = new Vulpin()
    sub.env = this.env
    sub.builtins = this.builtins
    sub.ml = this.ml
    sub.modules = this.modules
    const out = sub.run(src.slice(from, to).join('\n'), 4000, false)
    if (out.ok && out.quit) { this.output.push(...sub.output); throw new Error('QUIT::') }
    if (!out.ok && out.error === '::return::') {
      this.output.push(...sub.output)
      if (sub.retval !== undefined) this.retval = sub.retval
      throw new Error('::return::')
    }
    if (!out.ok) throw new Error('in ' + label + ': ' + out.error)
    if (sub.retval !== undefined) this.retval = sub.retval
    this.output.push(...sub.output)
    return retPc
  }

  /* ---------- expressions ---------- */

  evalExpr(s) {
    if (!s || !s.trim()) return ''
    this.toks = s.match(
      /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|\d+\.\d+|\d+|\$[A-Za-z_]\w*|<=|>=|==|!=|[A-Za-z_]\w*|[+\-*/%()[\]{}<>=,.,:$]/g
    ) || []
    this.pos = 0
    const v = this.sum()
    if (this.pos < this.toks.length) throw new Error('unexpected ' + JSON.stringify(this.toks[this.pos]))
    return v
  }

  peek() { return this.toks[this.pos] }
  take() { return this.toks[this.pos++] }

  sum() {
    let a = this.term()
    for (;;) {
      const t = this.peek()
      if (t === '+') { this.take(); a = this.arith(a, this.term(), '+') }
      else if (t === '-') { this.take(); a = this.arith(a, this.term(), '-') }
      else if (t === '==') { this.take(); a = this.eq(a, this.term()) ? 1 : 0 }
      else if (t === '=') { this.take(); a = this.eq(a, this.term()) ? 1 : 0 } // = means == inside conditions
      else if (t === '!=') { this.take(); a = this.eq(a, this.term()) ? 0 : 1 }
      else if (t === '>=') { this.take(); a = this.num(a) >= this.num(this.term()) ? 1 : 0 }
      else if (t === 'm') { this.take(); a = this.num(a) >= this.num(this.term()) ? 1 : 0 } // m means >=
      else if (t === '<=') { this.take(); a = this.num(a) <= this.num(this.term()) ? 1 : 0 }
      else if (t === 'l') { this.take(); a = this.num(a) <= this.num(this.term()) ? 1 : 0 } // l means <=
      else if (t === '>') { this.take(); a = this.num(a) > this.num(this.term()) ? 1 : 0 }
      else if (t === '<') { this.take(); a = this.num(a) < this.num(this.term()) ? 1 : 0 }
      else if (t === 'in') { this.take(); a = this.containsValue(a, this.term()) ? 1 : 0 }
      else break
    }
    return a
  }

  term() {
    let left = this.factor()
    for (;;) {
      const t = this.peek()
      if (t === '*') { this.take(); left = this.arith(left, this.factor(), '*') }
      else if (t === '/') { this.take(); left = this.arith(left, this.factor(), '/') }
      else if (t === '%') { this.take(); left = this.arith(left, this.factor(), '%') }
      else break
    }
    return left
  }

  factor() {
    const t = this.take()
    if (t === undefined) return ''
    if (t === '(') {
      const v = this.sum()
      if (this.peek() === ')') this.take()
      return this.postfix(v)
    }
    if (t === '[') {
      const v = this.listLit()
      if (this.peek() === ']') this.take()
      return this.postfix(v)
    }
    if (t === '{') {
      const v = this.braceLit()
      if (this.peek() === '}') this.take()
      return this.postfix(v)
    }
    if (t === '-' || t === '+') {
      const v = this.num(this.factor())
      return t === '-' ? -v : v
    }
    if (t[0] === '$') { // $var reference
      if (this.env[t.slice(1)] === undefined) throw new Error('$' + t.slice(1) + ' is not defined')
      return this.postfix(this.env[t.slice(1)])
    }
    if (t[0] === '"' || t[0] === "'") {
      return this.postfix(this.unquote(t))
    }
    if (this.isNum(t)) return this.postfix(t.includes('.') ? new VFloat(parseFloat(t)) : parseFloat(t))
    if (t === 'true') return true
    if (t === 'false') return false
    // module access: math.sqrt(16), os.name
    if (this.modules[t]) {
      if (this.peek() === '.') {
        this.take()
        const mem = this.take()
        const mod = this.modules[t]
        if (mod[mem] === undefined) throw new Error('no ' + t + '.' + mem + ' available')
        if (this.peek() === '(') {
          this.take()
          const args = []
          if (this.peek() !== ')') {
            args.push(this.sum())
            while (this.peek() === ',') { this.take(); args.push(this.sum()) }
          }
          if (this.peek() === ')') this.take()
          return this.postfix(typeof mod[mem] === 'function' ? mod[mem](...args) : mod[mem])
        }
        return this.postfix(mod[mem])
      }
      throw new Error(t + ' is a module — use ' + t + '.something')
    }
    if (this.peek() === '(') {
      this.take()
      const args = []
      if (this.peek() !== ')') {
        args.push(this.sum())
        while (this.peek() === ',') { this.take(); args.push(this.sum()) }
      }
      if (this.peek() === ')') this.take()
      return this.postfix(this.call(t, args))
    }
    if (this.env[t] !== undefined) {
      return this.postfix(this.env[t], t)
    }
    if (this.builtins[t]) return this.builtins[t]
    return 0
  }

  // handles trailing access: l[0], l[-1], d["a"] and string shortcuts .U .L .S .T .C
  postfix(v, name) {
    for (;;) {
      const t = this.peek()
      if (t === '[') {
        this.take()
        const idx = this.sum()
        if (this.peek() === ']') this.take()
        if (name !== undefined && (v === undefined || v === null)) throw new Error(name + ' is not defined')
        v = this.indexGet(v, idx)
      } else if (t === '.' && typeof v === 'string') {
        this.take()
        v = this.applyShortcut(v, this.take())
      } else break
    }
    return v
  }

  listLit() {
    const arr = []
    if (this.peek() !== ']') {
      arr.push(this.sum())
      while (this.peek() === ',') { this.take(); arr.push(this.sum()) }
    }
    return arr
  }

  braceLit() {
    if (this.peek() === '}') { this.take(); return new Map() } // {} is always a Dict
    const first = this.sum()
    if (this.peek() === ':') {
      this.take()
      const d = new Map()
      if (this.peek() === '}') { this.take(); return d }
      d.set(first, this.sum())
      while (this.peek() === ',') {
        this.take()
        const k = this.sum()
        if (this.peek() === ':') this.take()
        d.set(k, this.sum())
      }
      if (this.peek() === '}') this.take()
      return d
    }
    const st = new Set()
    st.add(first)
    while (this.peek() === ',') { this.take(); st.add(this.sum()) }
    if (this.peek() === '}') this.take()
    return st
  }

  indexGet(obj, idx) {
    if (Array.isArray(obj)) {
      let i = this.num(idx)
      if (i < 0) i += obj.length
      if (i < 0 || i >= obj.length) throw new Error('list index out of range')
      return obj[i]
    }
    if (obj instanceof Map) {
      if (!obj.has(idx)) throw new Error('key not found: ' + String(idx))
      return obj.get(idx)
    }
    throw new Error('indexing needs a List or Dict')
  }

  indexSet(obj, idx, value) {
    if (Array.isArray(obj)) {
      let i = this.num(idx)
      if (i < 0) i += obj.length
      if (i < 0 || i >= obj.length) throw new Error('list index out of range')
      obj[i] = value
      return
    }
    if (obj instanceof Map) { obj.set(idx, value); return }
    throw new Error('index assignment needs a List or Dict')
  }

  containsValue(a, b) {
    if (b instanceof Set) return b.has(a) || [...b].some((x) => this.eq(x, a))
    if (b instanceof Map) return b.has(a) || [...b.keys()].some((x) => this.eq(x, a))
    if (Array.isArray(b)) return b.some((x) => this.eq(x, a))
    if (typeof b === 'string') return String(b).includes(String(a))
    return false
  }

  applyShortcut(v, m) {
    const s = String(v)
    if (m === 'U') return s.toUpperCase()
    if (m === 'L') return s.toLowerCase()
    if (m === 'S') return s.trim()
    if (m === 'T') return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    if (m === 'C') return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
    return s
  }

  call(name, args) {
    const fn = this.env['fn:' + name]
    if (fn) {
      const sub = new Vulpin()
      sub.env = Object.assign(Object.create(null), this.env)
      sub.builtins = this.builtins
      sub.ml = this.ml
      sub.modules = this.modules
      fn.params.forEach((p, j) => { sub.env[p] = args[j] })
      const out = sub.run(fn.body.join('\n'), 2000, false)
      if (out.ok && out.quit) { this.output.push(...sub.output); throw new Error('QUIT::') }
      if (!out.ok && out.error !== '::return::') {
        this.output.push(...sub.output)
        throw new Error('inside ' + name + ': ' + out.error)
      }
      this.output.push(...sub.output)
      return sub.retval !== undefined ? sub.retval : ''
    }
    const b = this.builtins[name]
    if (b) return b(...args)
    return args[0] ?? 0
  }

  isNum(t) { return /^-?\d/.test(t) }

  coerceInput(raw, type) {
    const s = String(raw).trim()
    switch (type) {
      case 'I': { const n = parseInt(s, 10); return Number.isNaN(n) ? 0 : n }
      case 'F': { const n = parseFloat(s); return Number.isNaN(n) ? 0.0 : n }
      case 'N': { const n = parseFloat(s); return Number.isNaN(n) ? 0 : n }
      case 'L': return /^[a-zA-Z]$/.test(s) ? s : ''
      case 'W': return /^[a-zA-Z]+$/.test(s) ? s : ''
      case 'E': return /^[a-z]+$/.test(s) ? s : ''
      case 'U': return /^[A-Z]+$/.test(s) ? s : ''
      case 'A': return /^[a-zA-Z ]+$/.test(s) ? s : ''
      case 'P': return /^[a-zA-Z0-9 ]+$/.test(s) ? s : ''
      default: return s
    }
  }

  num(v) {
    if (v instanceof Number) return +v
    if (typeof v === 'string') {
      if (v === 'true') return 1
      if (v === 'false') return 0
      const n = parseFloat(v)
      return Number.isNaN(n) ? 0 : n
    }
    return typeof v === 'boolean' ? (v ? 1 : 0) : v
  }

  arith(a, b, op) {
    if (a instanceof Set || b instanceof Set) {
      if (op === '+') {
        const u = new Set(a instanceof Set ? a : [])
        const bi = b instanceof Set ? b : (Array.isArray(b) ? b : [])
        for (const x of bi) u.add(x)
        return u
      }
      if (op === '-' && a instanceof Set) {
        const d = new Set(a)
        const bset = b instanceof Set ? b : (Array.isArray(b) ? b : [])
        for (const x of bset) d.delete(x)
        return d
      }
    }
    if (Array.isArray(a) && op === '+') return Array.isArray(b) ? [...a, ...b] : [...a, b]
    const an = typeof a === 'string' || typeof b === 'string' ? null : this.num(a)
    const bn = typeof a === 'string' || typeof b === 'string' ? null : this.num(b)
    if (an === null || bn === null) {
      if (op === '+') return String(a) + String(b)
      if (op === '*') { const r = Number(this.num(a)) * Number(this.num(b)); return Number.isNaN(r) ? a : r }
      throw new Error('cannot ' + op + ' with a string')
    }
    if ((op === '/' || op === '%') && bn === 0) throw new Error('division by zero')
    switch (op) {
      case '+': return an + bn
      case '-': return an - bn
      case '*': return an * bn
      case '/': return this.isPlainInt(a) && this.isPlainInt(b) ? Math.trunc(an / bn) : an / bn
      case '%': return an % bn
    }
  }

  // A "float" only when it was written with a decimal point (VFloat);
  // 7.0 / 2 stays 3.5, plain 7 / 2 truncates toward zero.
  isPlainInt(x) {
    return typeof x === 'number' && Number.isInteger(x)
  }

  eq(a, b) { return String(a) === String(b) }
  unquote(t) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\n/g, '\n')
  }
  truthy(v) {
    if (v === 0 || v === false || v === '' || v === undefined || v === null) return false
    if (Array.isArray(v) && v.length === 0) return false
    if ((v instanceof Map || v instanceof Set) && v.size === 0) return false
    return true
  }
  println(v) { this.output.push(this.fmt(v)) }
  print(v) {
    const s = this.fmt(v)
    if (this.output.length) this.output[this.output.length - 1] += s
    else this.output.push(s)
  }
  fmt(v) {
    if (typeof v === 'boolean') return v ? '1' : '0'
    if (typeof v === 'string') return v
    if (v === undefined) return '0'
    return this.pyrepr(v)
  }
  pyrepr(v) {
    if (typeof v === 'boolean') return v ? 'True' : 'False'
    if (typeof v === 'string') return '"' + v + '"'
    if (v instanceof VFloat) {
      const s = String(+v)
      return /\./.test(s) ? s : s + '.0'
    }
    if (v instanceof Map) return '{' + Array.from(v.entries()).map(([k, x]) => this.pyrepr(k) + ': ' + this.pyrepr(x)).join(', ') + '}'
    if (v instanceof Set) return '{' + Array.from(v).map((x) => this.pyrepr(x)).join(', ') + '}'
    if (Array.isArray(v)) return '[' + v.map((x) => this.pyrepr(x)).join(', ') + ']'
    return String(v)
  }
}
