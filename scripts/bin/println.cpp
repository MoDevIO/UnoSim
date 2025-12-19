#include <iostream>
#include <chrono>
#include <thread>
int main(){
  std::cout.setf(std::ios::unitbuf);
  while(true){
    std::cout << "." << std::endl; // println
    // tight loop with minimal sleep to simulate fast sketch
    std::this_thread::sleep_for(std::chrono::microseconds(100));
  }
}
