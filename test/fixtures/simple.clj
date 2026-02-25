(ns myapp.core
  (:require [clojure.string :as str]))

(def config
  {:port 3000
   :host "localhost"})

;; Process incoming data
(defn process-data
  [items]
  (let [filtered (filter valid? items)]
    (map transform filtered)))

(defn- helper
  "A private helper function"
  [x]
  (str/upper-case (str x)))

(defmethod handle-event :click
  [event]
  (println "clicked!" event))

(defmethod handle-event :hover
  [event]
  (println "hovered!" event))
