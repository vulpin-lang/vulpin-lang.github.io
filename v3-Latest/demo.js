import { Vulpin } from './vulpin.js'

export const SAMPLES = [
  {
    name: 'hello world',
    src: `G "Hello World!"`,
  },
  {
    name: 'multiline text',
    src: `G '''
Vulpin is a tiny language
for tiny programs.
'''`,
  },
  {
    name: 'inline commands',
    src: `a = 5; ? a == 5; G "yes it is!";`,
  },
  {
    name: 'math',
    src: `G 7 / 2
G 7.0 / 2
G (2 + 3) * 4
G -3 + 10`,
  },
  {
    name: 'variables',
    src: `x = 10
name = "Vul"
G name
G x
D "x"`,
  },
  {
    name: 'add & replace',
    src: `E x = 3
A"x"+2
G x
S"name""Vul""VUL"
G name`,
  },
  {
    name: 'string shortcuts',
    src: `msg = "  hi there  "
G ($msg).U
G msg.T
G msg.S
G len(msg)`,
  },
  {
    name: 'lists',
    src: `l = [1, 2, 3]
G l
G l[0]
G l[-1]
l[0] = 99
push(l, 4)
G l
G pop(l)`,
  },
  {
    name: 'dicts',
    src: `d = {"name": "Vul", "age": 1}
d["home"] = "forest"
G d
G d["name"]
G keys(d)
G values(d)`,
  },
  {
    name: 'sets',
    src: `s = {1, 2, 3}
G s + {4}
G s - {2}
? 2 in s
  G "2 is in the set"
:`,
  },
  {
    name: 'if / else',
    src: `age = 17
? age >= 18
  G "you can vote"
:
  G "too young"
;`,
  },
  {
    name: 'comparisons',
    src: `score = 85
# m means >=, l means <=
? score m 90
  G "A"
:
? score m 80
  G "B"
:
  G "C"
;
;`,
  },
  {
    name: 'else-if chain',
    src: `num = 3
secret = 5
? num = secret
  G "Correct!"
  Q
:? num < secret G"Higher"
: G"Lower"
;`,
  },
  {
    name: 'while loop',
    src: `x = 0
@ x < 4
  G x
  x = x + 1
&`,
  },
  {
    name: 'for-range',
    src: `O i 0 5
  G i
&`,
  },
  {
    name: 'countdown',
    src: `O x 10 0 -2
  G x
&`,
  },
  {
    name: 'switch / case',
    src: `fruit = "apple"
W fruit
V "banana"
  G "yellow"
V "apple"
  G "red or green"
N
  G "unknown"
Z`,
  },
  {
    name: 'functions',
    src: `F add (a, b)
  R a + b
~
G add(3, 4)

F sayHi(name)
  G "Hello " + name
~
sayHi("World")`,
  },
  {
    name: 'recursion',
    src: `F fact (n)
  ? n <= 1
    R 1
  ;
  R n * fact($n - 1)
~
G fact(6)`,
  },
  {
    name: 'jumps',
    src: `? 2 > 3 J done
G "2 is not > 3, so this runs"
G "see you"
L done
G "Done"`,
  },
  {
    name: 'error handling',
    src: `T
  x = 10
  y = 0
  G x / y
C "err"
  G "Error: " + err
Y
G "Continues..."`,
  },
  {
    name: 'modules',
    src: `U"math"
G "Result: " + math.sqrt(16)`,
  },
  {
    name: 'rand module',
    src: `U"random"
r = random.randint(1, 10)
? r m 5
  G r + " is 5 or more"
:
  G r + " is under 5"
;`,
  },
  {
    name: 'os & shell',
    src: `U"os"
os.system("echo Hello from Vulpin")`,
  },
  {
    name: 'fizzbuzz',
    src: `O i 1 16
  ? i % 15 == 0
    G "fizzbuzz"
  :
  ? i % 3 == 0
    G "fizz"
  :
  ? i % 5 == 0
    G "buzz"
  :
    G i
  ;
  ;
  ;
&`,
  },
  {
    name: 'builtins',
    src: `G abs(-7)
G pow(2, 10)
G sqrt(81)
G min(3, 7)
G max(3, 7)
G len("vulpin")
G rand(100)`,
  },
]

export const state = {
  src: SAMPLES[0].src,
  logs: [],
}

const srcEl = document.getElementById('demoSrc')
const outEl = document.getElementById('demoOut')
const runBtn = document.getElementById('demoRun')
const statusEl = document.getElementById('demoStatus')
const samplesEl = document.getElementById('demoSamples')

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderLines(lines) {
  return lines.map((l) => `<span class="ln">${l}</span>`).join('')
}

export function setSource(src) {
  state.src = src
  if (srcEl) srcEl.value = src
}

export function runSource(src, opts = {}) {
  const v = new Vulpin()
  const res = v.run(src, 40000)
  const lines = []
  if (res.ok && res.quit) {
    // output already collected; QUIT just stops cleanly
  }
  if (!res.ok) {
    lines.push(`<span class="tc-err">error: ${esc(res.error)}</span>`)
  }
  v.output.forEach((o) => lines.push(`<span class="tc-out">${esc(o)}</span>`))
  if (res.ms !== undefined && !opts.silent) {
    lines.push(`<span class="tc-mut mut">— done in ${res.ms} ms —</span>`)
  }
  return { lines, res }
}

export function run(srcElVal) {
  const src = srcElVal ?? (srcEl ? srcEl.value : state.src)
  if (srcEl && !srcElVal) srcEl.value = src
  const { lines } = runSource(src)
  if (outEl) outEl.innerHTML = `<pre>${renderLines(lines)}</pre>`
  if (statusEl) statusEl.textContent = 'ran it'
}

function showError(e) {
  if (outEl) outEl.innerHTML = `<pre>${renderLines([`<span class="tc-err">ui error: ${esc(e.message)}</span>`])}</pre>`
}

function buildSamples() {
  if (!samplesEl) return
  SAMPLES.forEach((s, i) => {
    const b = document.createElement('button')
    b.className = 'chip'
    b.type = 'button'
    b.textContent = `${i + 1}. ${s.name}`
    b.title = s.src
    b.addEventListener('click', () => {
      setSource(s.src)
      run(s.src)
      if (statusEl) statusEl.textContent = `sample ${i + 1}: ${s.name}`
    })
    samplesEl.appendChild(b)
  })
}

function init() {
  buildSamples()
  if (srcEl) {
    srcEl.value = SAMPLES[0].src
    srcEl.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run() }
    })
    srcEl.addEventListener('input', () => { if (statusEl) statusEl.textContent = 'unsaved edits' })
  }
  if (runBtn) runBtn.addEventListener('click', () => run())

  // a typed-input sample needs browser prompt; show it last
  const kIdx = SAMPLES.length
  SAMPLES.push({
    name: 'typed input (K)',
    src: `K age "how old are you? " I
G "cool, " + age`,
  })
  const kb = document.createElement('button')
  kb.className = 'chip'
  kb.type = 'button'
  kb.textContent = `${kIdx + 1}. typed input (K)`
  kb.addEventListener('click', () => {
    setSource(SAMPLES[kIdx].src)
    run(SAMPLES[kIdx].src)
    if (statusEl) statusEl.textContent = 'sample: typed input (K)'
  })
  if (samplesEl) samplesEl.appendChild(kb)

  run(SAMPLES[0].src)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}

window.__vulpinDemo = { run, setSource, runSource, SAMPLES }