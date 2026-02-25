# A simple Janet file

(def greeting "hello world")

(defn greet
  "Greets a person by name"
  [name]
  (string greeting ", " name "!"))

(defn- internal-helper
  [x]
  (string/ascii-upper x))

(varfn extensible-fn
  [x]
  (+ x 1))
