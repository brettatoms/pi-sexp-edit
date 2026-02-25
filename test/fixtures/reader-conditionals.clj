(ns myapp.cross
  (:require [clojure.string :as str]))

;; Platform-specific code
(def platform
  #?(:clj "jvm"
     :cljs "js"))

(defn read-input
  [source]
  #?(:clj  (slurp source)
     :cljs (js/fetch source)))

;; Uses various reader macros
(defn complex-fn
  [items]
  (let [s #{1 2 3}
        f #(+ % 1)
        re #"foo\d+"
        m ^:private {:a 1}]
    #_(println "debug" items)
    @(future (map f items))))
