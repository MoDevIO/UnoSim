#include <iostream>
#include <chrono>
#include <thread>
int main(){
  std::cout.setf(std::ios::unitbuf);
  while(true){
    std::cout << "."; // print without newline
    std::this_thread::sleep_for(std::chrono::microseconds(100));
  }
}
